import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { createDeploymentRecord } from "./deployments";
import { dispatchDeploymentExecution } from "./deployment-dispatch";
import { environments, projects } from "../schema/projects";
import type { AppRole } from "@daoflow/shared";
import { asRecord, readNumber, readRecordArray, readString, readStringArray } from "./json-helpers";
import { buildComposeSourceSnapshot, resolveComposeImageOverride } from "./deployment-source";
import { prepareComposeDeploymentEnvState } from "./compose-env";
import { resolveTeamIdForUser } from "./teams";
import { revalidateProjectSourceForExecution } from "./project-source-execution-validation";

function formatReleaseTrackLabel(releaseTrack: string) {
  if (!releaseTrack) {
    return "Stable";
  }

  return `${releaseTrack.slice(0, 1).toUpperCase()}${releaseTrack.slice(1)}`;
}

function getReleaseTrackTone(releaseTrack: string) {
  return releaseTrack === "stable" ? "healthy" : "running";
}

export async function listComposeReleaseCatalog(limit = 24, teamId?: string) {
  const rows = (
    await db
      .select({ environment: environments })
      .from(environments)
      .innerJoin(projects, eq(projects.id, environments.projectId))
      .where(teamId ? eq(projects.teamId, teamId) : undefined)
      .orderBy(desc(environments.createdAt))
  ).map((row) => row.environment);
  const services = rows.flatMap((environment) => {
    const config = asRecord(environment.config);
    const composeServices = readRecordArray(config, "composeServices");

    return composeServices.map((service) => {
      const releaseTrack = readString(service, "releaseTrack", "stable");

      return {
        id: readString(service, "id"),
        environmentId: environment.id,
        environmentName: environment.name,
        projectName: readString(config, "projectName"),
        targetServerId: readString(config, "targetServerId"),
        targetServerName: readString(config, "targetServerName"),
        serviceName: readString(service, "serviceName"),
        composeFilePath: readString(config, "composeFilePath"),
        networkName: readString(config, "networkName"),
        imageReference: readString(service, "imageReference"),
        imageTag: readString(service, "imageReference"),
        replicaCount: readNumber(service, "replicaCount", 0) ?? 0,
        exposedPorts: readStringArray(service, "exposedPorts"),
        dependencies: readStringArray(service, "dependencies"),
        volumeMounts: readStringArray(service, "volumeMounts"),
        healthcheckPath: readString(service, "healthcheckPath") || null,
        releaseTrack,
        releaseTrackTone: getReleaseTrackTone(releaseTrack),
        releaseTrackLabel: formatReleaseTrackLabel(releaseTrack),
        status: environment.status,
        createdAt: environment.createdAt.toISOString()
      };
    });
  });

  const sliced = services.slice(0, limit);
  const networks = new Set(sliced.map((service) => service.networkName).filter(Boolean));
  const healthyEnvironments = new Set(
    rows
      .filter((environment) => environment.status === "healthy")
      .map((environment) => environment.id)
  );

  return {
    summary: {
      totalServices: sliced.length,
      statefulServices: sliced.filter(
        (service) =>
          service.serviceName.includes("postgres") ||
          service.volumeMounts.some((mount) => mount.includes("/var/lib/postgresql/data"))
      ).length,
      healthyEnvironments: healthyEnvironments.size,
      uniqueNetworks: networks.size
    },
    services: sliced
  };
}

export async function queueComposeRelease(input: {
  composeServiceId: string;
  commitSha: string;
  imageTag?: string | null;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: string;
  commandAuditAttemptId?: string;
  teamId?: string;
  operationId?: string;
  approvalRequestId?: string;
  approvalDispatchId?: string;
  preserveDispatchRetry?: boolean;
  approvalSnapshot?: Record<string, unknown>;
}) {
  const teamId = input.teamId ?? (await resolveTeamIdForUser(input.requestedByUserId));
  if (!teamId) return null;
  const catalog = await listComposeReleaseCatalog(100, teamId);
  const service = catalog.services.find((candidate) => candidate.id === input.composeServiceId);
  if (!service) return null;

  const expectedEnvironmentId = readString(input.approvalSnapshot ?? {}, "environmentId");
  const expectedTargetServerId = readString(input.approvalSnapshot ?? {}, "targetServerId");
  const expectedComposeFilePath = readString(input.approvalSnapshot ?? {}, "composeFilePath");
  const expectedPolicyRevision = readNumber(
    input.approvalSnapshot ?? {},
    "projectPreviewPolicyRevision",
    null
  );
  if (
    (expectedEnvironmentId && expectedEnvironmentId !== service.environmentId) ||
    (expectedTargetServerId && expectedTargetServerId !== service.targetServerId) ||
    (expectedComposeFilePath && expectedComposeFilePath !== service.composeFilePath)
  ) {
    return null;
  }

  const [environment] = await db
    .select()
    .from(environments)
    .where(eq(environments.id, service.environmentId))
    .limit(1);
  if (!environment) return null;

  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, environment.projectId))
    .limit(1);
  if (!project) return null;
  if (
    project.teamId !== teamId ||
    (expectedPolicyRevision !== null && project.previewPolicyRevision !== expectedPolicyRevision)
  ) {
    return null;
  }

  const sourceValidation = await revalidateProjectSourceForExecution({
    project,
    environment
  });
  if (
    sourceValidation.status === "invalid_source" ||
    sourceValidation.status === "provider_unavailable"
  ) {
    if (sourceValidation.status === "provider_unavailable") {
      throw new ComposeReleaseProviderUnavailableError(sourceValidation.message);
    }
    return null;
  }

  const envState = await prepareComposeDeploymentEnvState({
    environmentId: environment.id,
    serviceId: service.id,
    branch: project.defaultBranch ?? "main"
  });

  const configSnapshot: Record<string, unknown> = {
    ...buildComposeSourceSnapshot({
      project: {
        ...project,
        composePath: service.composeFilePath || project.composePath
      },
      environment,
      composeServiceName: service.serviceName
    }),
    composeEnv: envState.composeEnv
  };
  const effectiveImageTag = input.imageTag ?? service.imageReference;
  const composeImageOverride = resolveComposeImageOverride({
    serviceName: service.serviceName,
    composeServiceName: service.serviceName,
    requestedImageTag: input.imageTag,
    effectiveImageTag,
    serviceImageReference: service.imageReference
  });
  if (composeImageOverride) {
    configSnapshot.composeImageOverride = composeImageOverride;
  }

  const deployment = await createDeploymentRecord({
    deploymentId: input.operationId,
    projectName: service.projectName,
    environmentName: service.environmentName,
    serviceName: service.serviceName,
    sourceType: "compose",
    targetServerId: service.targetServerId,
    commitSha: input.commitSha,
    imageTag: effectiveImageTag,
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole as AppRole,
    teamId,
    commandAuditAttemptId: input.commandAuditAttemptId,
    approvalRequestId: input.approvalRequestId,
    approvalDispatchId: input.approvalDispatchId,
    envVarsEncrypted: envState.envVarsEncrypted,
    configSnapshot,
    steps: [
      {
        label: "Resolve compose diff",
        detail: `Render the Compose delta for ${service.serviceName} in ${service.environmentName}.`
      },
      {
        label: "Queue execution handoff",
        detail: "Package the release for the SSH-backed docker-ssh worker queue."
      }
    ]
  });

  if (!deployment) {
    return null;
  }

  await dispatchDeploymentExecution(deployment, {
    preserveDispatchRetry: input.preserveDispatchRetry
  });
  return deployment;
}

export class ComposeReleaseProviderUnavailableError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ComposeReleaseProviderUnavailableError";
  }
}
