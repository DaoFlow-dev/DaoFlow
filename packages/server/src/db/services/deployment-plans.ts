import { and, desc, eq } from "drizzle-orm";
import {
  formatDeploymentStatusLabel,
  getDeploymentStatusTone,
  normalizeDeploymentStatus
} from "@daoflow/shared";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { asRecord } from "./json-helpers";
import { resolveTeamIdForUser } from "./teams";

type PlanCheckStatus = "ok" | "warn" | "fail";
type DeploymentPlanSourceType = "compose" | "dockerfile" | "image";

function makeCheck(status: PlanCheckStatus, detail: string) {
  return { status, detail };
}

function normalizeSourceType(value: string): DeploymentPlanSourceType {
  if (value === "dockerfile" || value === "image") {
    return value;
  }

  return "compose";
}

async function resolveServiceForTeam(serviceRef: string, teamId: string) {
  const ref = serviceRef.trim();
  if (!ref) {
    throw new Error("Service reference is required.");
  }

  const [byId] = await db
    .select({ service: services })
    .from(services)
    .innerJoin(projects, eq(projects.id, services.projectId))
    .where(and(eq(services.id, ref), eq(projects.teamId, teamId)))
    .limit(1);
  if (byId) {
    return byId.service;
  }

  const matches = await db
    .select({ service: services })
    .from(services)
    .innerJoin(projects, eq(projects.id, services.projectId))
    .where(and(eq(services.name, ref), eq(projects.teamId, teamId)))
    .limit(2);
  if (matches.length > 1) {
    throw new Error(`Multiple services named "${ref}" exist. Use the service ID instead.`);
  }

  if (!matches[0]) {
    throw new Error(`Service "${ref}" not found.`);
  }

  return matches[0].service;
}

async function resolveServer(serverRef: string | undefined, fallbackServerId: string | null) {
  const ref = serverRef?.trim();

  if (ref) {
    const [byId] = await db.select().from(servers).where(eq(servers.id, ref)).limit(1);
    if (byId) {
      return byId;
    }

    const [byName] = await db.select().from(servers).where(eq(servers.name, ref)).limit(1);
    if (byName) {
      return byName;
    }

    throw new Error(`Server "${ref}" not found.`);
  }

  if (!fallbackServerId) {
    return null;
  }

  const [fallback] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, fallbackServerId))
    .limit(1);

  return fallback ?? null;
}

function buildPlanSteps(input: {
  sourceType: "compose" | "dockerfile" | "image";
  imageTag: string | null;
  hasDockerfilePath: boolean;
  hasHealthcheck: boolean;
  targetServerName: string;
}) {
  const serverStep = `Dispatch execution to ${input.targetServerName}`;
  const verifyStep = input.hasHealthcheck
    ? "Run configured health check and promote only if it stays green"
    : "Verify container and compose status, then mark the rollout outcome";

  switch (input.sourceType) {
    case "compose":
      return [
        "Freeze the compose inputs and resolved runtime spec",
        input.imageTag
          ? `Pull ${input.imageTag} and refresh compose services`
          : "Resolve image references from the compose spec and refresh services",
        "Apply docker compose up -d with the staged configuration",
        verifyStep,
        serverStep
      ];
    case "dockerfile":
      return [
        "Freeze Dockerfile inputs and build context",
        input.hasDockerfilePath
          ? "Build the image from the configured Dockerfile"
          : "Build the image using the default Dockerfile path",
        "Replace the running container with the new image",
        verifyStep,
        serverStep
      ];
    case "image":
    default:
      return [
        `Pull ${input.imageTag ?? "the configured image reference"}`,
        "Stop the existing container and start the new image",
        verifyStep,
        serverStep
      ];
  }
}

export interface BuildDeploymentPlanInput {
  serviceRef: string;
  serverRef?: string;
  imageTag?: string;
  requestedByUserId: string;
}

export async function buildDeploymentPlan(input: BuildDeploymentPlanInput) {
  const teamId = await resolveTeamIdForUser(input.requestedByUserId);
  if (!teamId) {
    throw new Error("No organization is available for this user.");
  }

  const service = await resolveServiceForTeam(input.serviceRef, teamId);
  const [project, environment] = await Promise.all([
    db.select().from(projects).where(eq(projects.id, service.projectId)).limit(1),
    db.select().from(environments).where(eq(environments.id, service.environmentId)).limit(1)
  ]);

  if (!project[0] || !environment[0]) {
    throw new Error(`Service "${service.name}" is missing its project or environment linkage.`);
  }

  const environmentConfig = asRecord(environment[0].config);
  const environmentTargetServerId =
    typeof environmentConfig.targetServerId === "string" ? environmentConfig.targetServerId : null;
  const configuredTargetServerId = service.targetServerId ?? environmentTargetServerId;
  const configuredServer = await resolveServer(undefined, configuredTargetServerId);
  const resolvedServer = input.serverRef
    ? await resolveServer(input.serverRef, null)
    : configuredServer;

  if (input.serverRef) {
    if (!configuredTargetServerId) {
      throw new Error(
        "This service does not have a configured target server. Set the service or environment target first."
      );
    }

    if (!resolvedServer || resolvedServer.id !== configuredTargetServerId) {
      throw new Error("Requested server does not match this service's configured target.");
    }
  }

  const effectiveImageTag = input.imageTag?.trim() || service.imageReference || null;

  const [latestDeployment] = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.environmentId, service.environmentId),
        eq(deployments.serviceName, service.name)
      )
    )
    .orderBy(desc(deployments.createdAt))
    .limit(1);

  const sourceType = normalizeSourceType(service.sourceType);

  const checks = [
    makeCheck("ok", `Service ${service.name} is registered in ${environment[0].name}.`),
    resolvedServer
      ? makeCheck(
          "ok",
          `Target server resolved to ${resolvedServer.name} (${resolvedServer.host}).`
        )
      : makeCheck("fail", "No target server is configured for this service or environment."),
    sourceType === "dockerfile" && !service.dockerfilePath
      ? makeCheck("warn", "Dockerfile path is not set; the worker will fall back to the default.")
      : makeCheck("ok", `Source type is ${sourceType}.`),
    effectiveImageTag
      ? makeCheck("ok", `Deployment input will use ${effectiveImageTag}.`)
      : makeCheck("warn", "No explicit image reference is configured; execution must derive one.")
  ];

  const steps = buildPlanSteps({
    sourceType,
    imageTag: effectiveImageTag,
    hasDockerfilePath: Boolean(service.dockerfilePath),
    hasHealthcheck: Boolean(service.healthcheckPath),
    targetServerName: resolvedServer?.name ?? "the configured worker"
  });

  const currentDeployment = latestDeployment
    ? {
        id: latestDeployment.id,
        status: normalizeDeploymentStatus(latestDeployment.status, latestDeployment.conclusion),
        statusLabel: formatDeploymentStatusLabel(
          latestDeployment.status,
          latestDeployment.conclusion
        ),
        statusTone: getDeploymentStatusTone(latestDeployment.status, latestDeployment.conclusion),
        imageTag: latestDeployment.imageTag,
        commitSha: latestDeployment.commitSha,
        createdAt: latestDeployment.createdAt.toISOString(),
        finishedAt: latestDeployment.concludedAt?.toISOString() ?? null
      }
    : null;

  return {
    isReady: checks.every((check) => check.status !== "fail"),
    service: {
      id: service.id,
      name: service.name,
      sourceType,
      projectId: project[0].id,
      projectName: project[0].name,
      environmentId: environment[0].id,
      environmentName: environment[0].name,
      imageReference: service.imageReference,
      dockerfilePath: service.dockerfilePath,
      composeServiceName: service.composeServiceName,
      healthcheckPath: service.healthcheckPath
    },
    target: {
      serverId: resolvedServer?.id ?? null,
      serverName: resolvedServer?.name ?? null,
      serverHost: resolvedServer?.host ?? null,
      imageTag: effectiveImageTag
    },
    currentDeployment,
    preflightChecks: checks,
    steps,
    executeCommand: [
      "daoflow deploy",
      `--service ${service.id}`,
      resolvedServer ? `--server ${resolvedServer.id}` : null,
      effectiveImageTag ? `--image ${effectiveImageTag}` : null,
      "--yes"
    ]
      .filter(Boolean)
      .join(" ")
  };
}
