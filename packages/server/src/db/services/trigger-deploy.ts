/**
 * trigger-deploy.ts
 *
 * Creates a deployment record from a service definition.
 * The worker picks up queued deployments via its existing polling loop.
 */

import { and, desc, eq } from "drizzle-orm";
import { basename, isAbsolute } from "node:path";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { services } from "../schema/services";
import {
  createDeploymentRecord,
  type CreateDeploymentInput,
  type DeploymentTrigger
} from "./deployments";
import { dispatchDeploymentExecution } from "./deployment-dispatch";
import type { AppRole } from "@daoflow/shared";
import { asRecord, readString } from "./json-helpers";
import {
  readComposeReadinessProbeFromConfig,
  snapshotComposeReadinessProbe
} from "../../compose-readiness";
import {
  buildComposeSourceSnapshot,
  buildRepositorySourceSnapshot,
  extractReplayableConfigSnapshot,
  resolveComposeImageOverride
} from "./deployment-source";
import { prepareComposeDeploymentEnvState } from "./compose-env";
import { revalidateProjectSourceForExecution } from "./project-source-execution-validation";
import {
  buildComposePreviewEnvEntries,
  deriveComposePreviewMetadata,
  normalizeComposePreviewRequest,
  previewModeAllowsRequest,
  readComposePreviewConfigFromConfig,
  type ComposePreviewRequestInput
} from "../../compose-preview";
import { readServiceRuntimeConfigFromConfig } from "../../service-runtime-config";
import { buildManagedTraefikRoutingPlan } from "../../managed-traefik";
import { readServiceDomainConfigFromConfig } from "../../service-domain-config";
import { resolveServiceForUser } from "./scoped-services";
import { recordPreviewEnvironmentDeployment } from "./preview-environments";
import {
  validatePreviewDeploymentAuthorization,
  type PreviewAuthorization
} from "../../preview-trust";
import { getServerForTeam } from "./team-scoped-servers";

export interface TriggerDeployInput {
  serviceId: string;
  commitSha?: string;
  imageTag?: string;
  preview?: ComposePreviewRequestInput;
  previewProviderType?: string | null;
  previewAuthorization?: PreviewAuthorization;
  composeOperation?: "up" | "down";
  requestedByUserId?: string | null;
  requestedByEmail?: string | null;
  requestedByRole?: AppRole | null;
  commandAuditAttemptId?: string;
  webhookDelivery?: {
    deliveryId: string;
    targetKey: string;
  };
  trigger?: DeploymentTrigger;
  teamId?: string;
  operationId?: string;
  approvalRequestId?: string;
  approvalDispatchId?: string;
  preserveDispatchRetry?: boolean;
  approvalSnapshot?: Record<string, unknown>;
}

/** Generate deployment steps based on sourceType. */
function stepsForSourceType(input: {
  sourceType: string;
  targetKind?: string | null;
  composeOperation?: "up" | "down";
  hasPreview?: boolean;
}): { label: string; detail: string }[] {
  const isSwarmCompose =
    input.sourceType === "compose" && input.targetKind === "docker-swarm-manager";
  switch (input.sourceType) {
    case "compose":
      return [
        {
          label: "Prepare deployment inputs",
          detail: input.hasPreview
            ? "Resolved preview compose source inputs, deployment env state, and replayable config snapshot."
            : "Resolved compose source inputs, deployment env state, and replayable config snapshot."
        },
        {
          label: "Queue execution handoff",
          detail:
            input.composeOperation === "down"
              ? isSwarmCompose
                ? "Dispatch the Swarm preview cleanup to the execution plane."
                : "Dispatch the compose preview cleanup to the execution plane."
              : isSwarmCompose
                ? "Dispatch the Swarm stack deployment to the execution plane."
                : "Dispatch the compose deployment to the execution plane."
        }
      ];
    case "dockerfile":
      return [
        {
          label: "Prepare deployment inputs",
          detail: "Resolved Dockerfile source inputs and created an immutable deployment snapshot."
        },
        {
          label: "Queue execution handoff",
          detail: "Dispatch the Dockerfile deployment to the execution plane."
        }
      ];
    case "image":
      return [
        {
          label: "Prepare deployment inputs",
          detail: "Resolved the image reference and created an immutable deployment snapshot."
        },
        {
          label: "Queue execution handoff",
          detail: "Dispatch the image deployment to the execution plane."
        }
      ];
    default:
      return [{ label: "Queue execution handoff", detail: "Dispatch the deployment job." }];
  }
}

function normalizeRepositoryPath(path: string, fallback: string): string {
  if (!path) return fallback;
  return isAbsolute(path) ? basename(path) : path;
}

function hasRepositorySource(project: typeof projects.$inferSelect): boolean {
  return Boolean(
    project.repoUrl || project.repoFullName || project.gitProviderId || project.gitInstallationId
  );
}

function isReplayableUploadedSnapshot(snapshot: Record<string, unknown>): boolean {
  const deploymentSource = readString(snapshot, "deploymentSource");
  const uploadedArtifactId = readString(snapshot, "uploadedArtifactId");

  return (
    (deploymentSource === "uploaded-compose" || deploymentSource === "uploaded-context") &&
    uploadedArtifactId.length > 0
  );
}

async function findLatestReplayableUploadedDeployment(input: {
  projectId: string;
  environmentId: string;
  serviceName: string;
}) {
  const candidates = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.projectId, input.projectId),
        eq(deployments.environmentId, input.environmentId),
        eq(deployments.serviceName, input.serviceName),
        eq(deployments.sourceType, "compose")
      )
    )
    .orderBy(desc(deployments.createdAt))
    .limit(20);

  for (const candidate of candidates) {
    const snapshot = asRecord(candidate.configSnapshot);
    if (isReplayableUploadedSnapshot(snapshot)) {
      return candidate;
    }
  }

  return null;
}

export async function triggerDeploy(input: TriggerDeployInput) {
  // Look up the service
  const svc = input.teamId
    ? await db
        .select({ service: services })
        .from(services)
        .innerJoin(projects, eq(projects.id, services.projectId))
        .where(and(eq(services.id, input.serviceId), eq(projects.teamId, input.teamId)))
        .limit(1)
        .then((rows) => rows[0]?.service ?? null)
    : input.requestedByUserId
      ? await resolveServiceForUser(input.serviceId, input.requestedByUserId).catch(() => null)
      : await db
          .select()
          .from(services)
          .where(eq(services.id, input.serviceId))
          .limit(1)
          .then((rows) => rows[0] ?? null);

  if (!svc) return { status: "not_found" as const, entity: "service" };

  // Look up the environment to get project context
  const [env] = await db
    .select()
    .from(environments)
    .where(eq(environments.id, svc.environmentId))
    .limit(1);

  if (!env) return { status: "not_found" as const, entity: "environment" };

  const [project] = await db.select().from(projects).where(eq(projects.id, env.projectId)).limit(1);

  if (!project) return { status: "not_found" as const, entity: "project" };

  const previewRequest = input.preview ? normalizeComposePreviewRequest(input.preview) : null;

  // Determine target server
  const envConfig = env.config && typeof env.config === "object" ? env.config : {};
  const targetServerId =
    svc.targetServerId ??
    ((envConfig as Record<string, unknown>).targetServerId as string | undefined);

  if (!targetServerId) {
    return { status: "no_server" as const };
  }
  const targetServer = await getServerForTeam(targetServerId, project.teamId);
  if (!targetServer) {
    return { status: "no_server" as const };
  }
  const approvalSnapshot = input.approvalSnapshot ?? {};
  const expectedProjectId =
    typeof approvalSnapshot.projectId === "string" ? approvalSnapshot.projectId : "";
  const expectedEnvironmentId =
    typeof approvalSnapshot.environmentId === "string" ? approvalSnapshot.environmentId : "";
  const expectedTargetServerId =
    typeof approvalSnapshot.targetServerId === "string" ? approvalSnapshot.targetServerId : "";
  const expectedPolicyRevision =
    typeof approvalSnapshot.projectPreviewPolicyRevision === "number"
      ? approvalSnapshot.projectPreviewPolicyRevision
      : null;
  if (
    (expectedProjectId && expectedProjectId !== project.id) ||
    (expectedEnvironmentId && expectedEnvironmentId !== env.id) ||
    (expectedTargetServerId && expectedTargetServerId !== targetServerId) ||
    (expectedPolicyRevision !== null && expectedPolicyRevision !== project.previewPolicyRevision)
  ) {
    return {
      status: "invalid_preview" as const,
      message:
        "The approved preview snapshot no longer matches the current execution target or policy."
    };
  }

  const composeProjectHasRepositorySource =
    svc.sourceType === "compose" ? hasRepositorySource(project) : false;
  if (previewRequest && svc.sourceType !== "compose") {
    return {
      status: "invalid_preview" as const,
      message: "Preview deployments are only supported for compose services."
    };
  }

  if (previewRequest?.target === "pull-request" && previewRequest.action === "deploy") {
    const authorization = await validatePreviewDeploymentAuthorization({
      authorization: input.previewAuthorization,
      project,
      serviceId: svc.id,
      providerType:
        input.previewProviderType === "github" || input.previewProviderType === "gitlab"
          ? input.previewProviderType
          : null,
      commitSha: input.commitSha ?? "",
      preview: previewRequest
    });
    if (!authorization.allowed) {
      return {
        status: "preview_approval_required" as const,
        message: authorization.reason
      };
    }
  }

  if (svc.sourceType === "compose" && composeProjectHasRepositorySource) {
    const sourceValidation = await revalidateProjectSourceForExecution({
      project,
      environment: env
    });

    if (sourceValidation.status === "invalid_source") {
      return sourceValidation;
    }
    if (sourceValidation.status === "provider_unavailable") {
      return sourceValidation;
    }
  }

  const buildConfig = asRecord(svc.config);
  const readinessProbe = readComposeReadinessProbeFromConfig(buildConfig);
  const previewConfig = readComposePreviewConfigFromConfig(buildConfig);
  const runtimeConfig = readServiceRuntimeConfigFromConfig(buildConfig);
  const domainConfig = readServiceDomainConfigFromConfig(buildConfig);
  const configSnapshot: Record<string, unknown> = composeProjectHasRepositorySource
    ? buildRepositorySourceSnapshot(project)
    : {};
  if (input.webhookDelivery) {
    configSnapshot.webhookDelivery = input.webhookDelivery;
  }
  let envVarsEncrypted: string | null = null;
  let replayedComposeDeployment: typeof deployments.$inferSelect | null = null;
  let previewMetadata: ReturnType<typeof deriveComposePreviewMetadata> | null = null;

  if (svc.sourceType === "compose") {
    if (previewRequest) {
      if (!composeProjectHasRepositorySource) {
        return {
          status: "invalid_preview" as const,
          message:
            "Preview deployments require a git-backed compose service so DaoFlow can check out the requested branch."
        };
      }
      if (!previewConfig?.enabled) {
        return {
          status: "invalid_preview" as const,
          message: "Preview deployments are not enabled for this compose service."
        };
      }
      if (!previewModeAllowsRequest(previewConfig.mode, previewRequest)) {
        return {
          status: "invalid_preview" as const,
          message: `Preview mode ${previewConfig.mode} does not allow ${previewRequest.target} preview requests.`
        };
      }
    }

    if (composeProjectHasRepositorySource) {
      Object.assign(
        configSnapshot,
        buildComposeSourceSnapshot({
          project,
          environment: env,
          composeServiceName: svc.composeServiceName
        })
      );

      if (previewRequest && previewConfig) {
        previewMetadata = deriveComposePreviewMetadata({
          config: previewConfig,
          request: previewRequest,
          projectName: project.name,
          environmentName: env.name,
          serviceName: svc.name,
          baseStackName: project.name
        });
        configSnapshot.branch = previewRequest.branch;
        configSnapshot.composeEnvBranch = previewMetadata.envBranch;
        configSnapshot.stackName = previewMetadata.stackName;
        configSnapshot.composeOperation = previewRequest.action === "destroy" ? "down" : "up";
        configSnapshot.preview = previewMetadata;
      } else {
        configSnapshot.composeOperation = input.composeOperation ?? "up";
      }

      if (previewRequest?.action !== "destroy") {
        const envState = await prepareComposeDeploymentEnvState({
          environmentId: env.id,
          serviceId: svc.id,
          branch:
            typeof configSnapshot.composeEnvBranch === "string"
              ? configSnapshot.composeEnvBranch
              : typeof configSnapshot.branch === "string"
                ? configSnapshot.branch
                : "main",
          additionalEntries:
            previewMetadata !== null ? buildComposePreviewEnvEntries(previewMetadata) : undefined
        });
        configSnapshot.composeEnv = envState.composeEnv;
        envVarsEncrypted = envState.envVarsEncrypted;
      }
    } else {
      replayedComposeDeployment = await findLatestReplayableUploadedDeployment({
        projectId: project.id,
        environmentId: env.id,
        serviceName: svc.name
      });

      if (!replayedComposeDeployment) {
        return {
          status: "invalid_source" as const,
          message:
            `Service ${svc.name} has no repository source and no retained uploaded artifact ` +
            "snapshot available for replay. Re-upload the compose source before triggering a redeploy."
        };
      }

      Object.assign(
        configSnapshot,
        extractReplayableConfigSnapshot(asRecord(replayedComposeDeployment.configSnapshot))
      );
      configSnapshot.composeOperation = input.composeOperation ?? "up";
      envVarsEncrypted = replayedComposeDeployment.envVarsEncrypted;
    }
  }

  delete configSnapshot.readinessProbe;
  if (readinessProbe) {
    configSnapshot.readinessProbe = snapshotComposeReadinessProbe({
      probe: readinessProbe,
      serviceName: svc.composeServiceName ?? svc.name
    });
  }
  if (svc.sourceType === "compose") {
    configSnapshot.runtimeConfig = runtimeConfig;
  }
  if (
    svc.sourceType === "compose" &&
    configSnapshot.composeOperation !== "down" &&
    targetServer.kind === "docker-engine"
  ) {
    const managedTraefikRouting = buildManagedTraefikRoutingPlan({
      service: svc,
      server: targetServer,
      domains: domainConfig?.domains ?? [],
      portMappings: domainConfig?.portMappings ?? []
    });
    if (managedTraefikRouting?.routes.length) {
      configSnapshot.managedTraefikRouting = managedTraefikRouting;
    }
  }

  if (svc.sourceType === "dockerfile") {
    configSnapshot.dockerfile = normalizeRepositoryPath(
      svc.dockerfilePath ?? "Dockerfile",
      "Dockerfile"
    );
    configSnapshot.buildContext = readString(buildConfig, "buildContext", ".");
  }

  if (svc.port) {
    configSnapshot.ports = [svc.port];
  }

  const effectiveImageTag =
    input.imageTag ?? svc.imageReference ?? replayedComposeDeployment?.imageTag ?? "";
  const composeImageOverride =
    svc.sourceType === "compose"
      ? resolveComposeImageOverride({
          serviceName: svc.name,
          composeServiceName: svc.composeServiceName,
          requestedImageTag: input.imageTag,
          effectiveImageTag,
          serviceImageReference: svc.imageReference,
          existingOverride: configSnapshot.composeImageOverride
        })
      : undefined;

  if (composeImageOverride) {
    configSnapshot.composeImageOverride = composeImageOverride;
  } else {
    delete configSnapshot.composeImageOverride;
  }

  const deployInput: CreateDeploymentInput = {
    deploymentId: input.operationId,
    projectName: project.name,
    environmentName: env.name,
    serviceName: svc.name,
    sourceType: svc.sourceType as "compose" | "dockerfile" | "image",
    targetServerId,
    commitSha: input.commitSha ?? replayedComposeDeployment?.commitSha ?? "",
    imageTag: effectiveImageTag,
    requestedByUserId: input.requestedByUserId ?? null,
    requestedByEmail: input.requestedByEmail ?? null,
    requestedByRole: input.requestedByRole ?? null,
    teamId: project.teamId,
    commandAuditAttemptId: input.commandAuditAttemptId,
    webhookDelivery: input.webhookDelivery,
    approvalRequestId: input.approvalRequestId,
    approvalDispatchId: input.approvalDispatchId,
    trigger: input.trigger ?? "user",
    steps: stepsForSourceType({
      sourceType: svc.sourceType,
      targetKind: targetServer.kind,
      composeOperation: configSnapshot.composeOperation === "down" ? "down" : "up",
      hasPreview: configSnapshot.preview !== undefined
    }),
    configSnapshot,
    envVarsEncrypted
  };

  const deployment = await createDeploymentRecord(deployInput);
  if (!deployment) return { status: "create_failed" as const };
  if (previewMetadata) {
    const [rawDeployment] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deployment.id))
      .limit(1);
    if (!rawDeployment) return { status: "create_failed" as const };
    await recordPreviewEnvironmentDeployment({
      service: svc,
      teamId: project.teamId,
      metadata: previewMetadata,
      deployment: rawDeployment,
      providerType:
        input.previewProviderType ?? (input.trigger === "webhook" ? "webhook" : "manual"),
      configInventory: configSnapshot.composeEnv
    });
  }
  await dispatchDeploymentExecution(deployment, {
    preserveDispatchRetry: input.preserveDispatchRetry
  });

  return { status: "ok" as const, deployment };
}
