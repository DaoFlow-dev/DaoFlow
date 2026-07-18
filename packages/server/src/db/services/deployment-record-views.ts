import {
  DeploymentHealthStatus,
  canCancelDeployment,
  canRollbackDeployment,
  formatDeploymentStatusLabel,
  getDeploymentStatusTone,
  normalizeDeploymentStatus
} from "@daoflow/shared";
import { db } from "../connection";
import { deploymentBuildLeases, deployments, deploymentSteps } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { and, asc, eq, gt, inArray } from "drizzle-orm";
import { asRecord, readString } from "./json-helpers";
import { readComposePreviewMetadata } from "../../compose-preview";
import { readDeploymentCancellationSnapshot } from "../../deployment-cancellation";
import { summarizeDeploymentHealth, summarizeRolloutStrategy } from "./deployment-read-model";
import { buildDeploymentRecoveryGuidance } from "./deployment-recovery-guidance";
import { buildDeploymentStateArtifacts } from "./deployment-state-artifacts";

export interface DeploymentIndex {
  projectById: Map<string, typeof projects.$inferSelect>;
  environmentById: Map<string, typeof environments.$inferSelect>;
  serverById: Map<string, typeof servers.$inferSelect>;
  serviceByKey: Map<string, typeof services.$inferSelect>;
  queueByDeploymentId: Map<string, DeploymentQueueState>;
}

export interface DeploymentQueueState {
  reason: "build-slot";
  position: number;
  activeBuilds: number;
  maxConcurrentBuilds: number;
}

export async function loadProjectEnvironmentByNames(projectName: string, environmentName: string) {
  const [project] = await db.select().from(projects).where(eq(projects.name, projectName)).limit(1);
  if (!project) return null;

  const [environment] = await db
    .select()
    .from(environments)
    .where(and(eq(environments.projectId, project.id), eq(environments.name, environmentName)))
    .limit(1);

  if (!environment) return null;
  return { project, environment };
}

export async function buildDeploymentIndex(
  deploymentRows: (typeof deployments.$inferSelect)[]
): Promise<DeploymentIndex> {
  if (deploymentRows.length === 0) {
    return {
      projectById: new Map<string, typeof projects.$inferSelect>(),
      environmentById: new Map<string, typeof environments.$inferSelect>(),
      serverById: new Map<string, typeof servers.$inferSelect>(),
      serviceByKey: new Map<string, typeof services.$inferSelect>(),
      queueByDeploymentId: new Map<string, DeploymentQueueState>()
    };
  }

  const projectIds = [...new Set(deploymentRows.map((row) => row.projectId))];
  const environmentIds = [...new Set(deploymentRows.map((row) => row.environmentId))];
  const serverIds = [...new Set(deploymentRows.map((row) => row.targetServerId))];

  const now = new Date();
  const [projectRows, environmentRows, serverRows, serviceRows, waitingRows, activeLeaseRows] =
    await Promise.all([
      db.select().from(projects).where(inArray(projects.id, projectIds)),
      db.select().from(environments).where(inArray(environments.id, environmentIds)),
      db.select().from(servers).where(inArray(servers.id, serverIds)),
      db.select().from(services).where(inArray(services.environmentId, environmentIds)),
      db
        .select({
          id: deployments.id,
          serverId: deployments.targetServerId
        })
        .from(deployments)
        .where(
          and(inArray(deployments.targetServerId, serverIds), eq(deployments.status, "waiting"))
        )
        .orderBy(asc(deployments.targetServerId), asc(deployments.createdAt), asc(deployments.id)),
      db
        .select({
          deploymentId: deploymentBuildLeases.deploymentId,
          serverId: deploymentBuildLeases.serverId
        })
        .from(deploymentBuildLeases)
        .where(
          and(
            inArray(deploymentBuildLeases.serverId, serverIds),
            gt(deploymentBuildLeases.expiresAt, now)
          )
        )
    ]);

  const activeLeaseIds = new Set(activeLeaseRows.map((lease) => lease.deploymentId));
  const activeBuildsByServerId = new Map<string, number>();
  for (const lease of activeLeaseRows) {
    activeBuildsByServerId.set(
      lease.serverId,
      (activeBuildsByServerId.get(lease.serverId) ?? 0) + 1
    );
  }
  const serverById = new Map(serverRows.map((row) => [row.id, row]));
  const nextPositionByServerId = new Map<string, number>();
  const queueByDeploymentId = new Map<string, DeploymentQueueState>();
  for (const waiting of waitingRows) {
    if (activeLeaseIds.has(waiting.id)) continue;
    const server = serverById.get(waiting.serverId);
    if (!server) continue;
    const position = (nextPositionByServerId.get(waiting.serverId) ?? 0) + 1;
    nextPositionByServerId.set(waiting.serverId, position);
    queueByDeploymentId.set(waiting.id, {
      reason: "build-slot",
      position,
      activeBuilds: activeBuildsByServerId.get(waiting.serverId) ?? 0,
      maxConcurrentBuilds: server.maxConcurrentBuilds
    });
  }

  return {
    projectById: new Map(projectRows.map((row) => [row.id, row])),
    environmentById: new Map(environmentRows.map((row) => [row.id, row])),
    serverById,
    serviceByKey: new Map(
      serviceRows.map((row) => [`${row.projectId}:${row.environmentId}:${row.name}`, row] as const)
    ),
    queueByDeploymentId
  };
}

export function buildDeploymentView(
  deployment: typeof deployments.$inferSelect,
  project: typeof projects.$inferSelect | undefined,
  environment: typeof environments.$inferSelect | undefined,
  server: typeof servers.$inferSelect | undefined,
  service: typeof services.$inferSelect | undefined,
  steps: (typeof deploymentSteps.$inferSelect)[],
  queueState?: DeploymentQueueState
) {
  const snapshot = asRecord(deployment.configSnapshot);
  const preview = readComposePreviewMetadata(snapshot.preview);
  const status = normalizeDeploymentStatus(deployment.status, deployment.conclusion);
  const statusLabel = formatDeploymentStatusLabel(deployment.status, deployment.conclusion);
  const statusTone = getDeploymentStatusTone(deployment.status, deployment.conclusion);
  const hasServiceTarget = typeof service?.id === "string";
  const cancellation = readDeploymentCancellationSnapshot(snapshot);
  const cancellationRequested = cancellation !== null && status === DeploymentHealthStatus.Running;
  const healthSummary = summarizeDeploymentHealth({ deployment, steps });
  const rolloutStrategy = summarizeRolloutStrategy({
    sourceType: deployment.sourceType,
    serviceConfig: service?.config,
    deploymentSnapshot: deployment.configSnapshot,
    healthcheckPath: service?.healthcheckPath ?? null
  });
  const stateArtifacts = buildDeploymentStateArtifacts({
    deployment,
    environment,
    service,
    server
  });
  const recoveryGuidance = buildDeploymentRecoveryGuidance(deployment);
  const temporalWorkflowId = readString(snapshot, "temporalWorkflowId") || null;
  const temporalRunId = readString(snapshot, "temporalRunId") || null;

  return {
    ...deployment,
    lifecycleStatus: deployment.status,
    status,
    statusTone,
    statusLabel,
    serviceId: service?.id ?? null,
    canCancel:
      !cancellationRequested && canCancelDeployment(deployment.status, deployment.conclusion),
    canRollback: canRollbackDeployment(deployment.status, deployment.conclusion, hasServiceTarget),
    cancellationRequested,
    projectName: project?.name ?? readString(snapshot, "projectName", deployment.projectId),
    environmentName:
      environment?.name ?? readString(snapshot, "environmentName", deployment.environmentId),
    stackName: readString(
      snapshot,
      "stackName",
      readString(snapshot, "projectName", deployment.projectId)
    ),
    preview,
    executionEngine: temporalWorkflowId ? ("temporal" as const) : ("legacy" as const),
    temporalWorkflowId,
    temporalRunId,
    queueState: queueState ?? null,
    targetServerName:
      server?.name ?? readString(snapshot, "targetServerName", deployment.targetServerId),
    targetServerHost:
      server?.host ?? readString(snapshot, "targetServerHost", deployment.targetServerId),
    createdAt: deployment.createdAt.toISOString(),
    startedAt: deployment.createdAt.toISOString(),
    finishedAt: deployment.concludedAt?.toISOString() ?? null,
    healthSummary,
    recoveryGuidance,
    rolloutStrategy,
    stateArtifacts,
    steps: steps.map((step, index) => ({
      ...step,
      position: index + 1,
      startedAt: step.startedAt?.toISOString() ?? null,
      finishedAt: step.completedAt?.toISOString() ?? null
    }))
  };
}
