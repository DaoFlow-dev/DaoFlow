import {
  DeploymentHealthStatus,
  canCancelDeployment,
  canRollbackDeployment,
  formatDeploymentStatusLabel,
  getDeploymentStatusTone,
  normalizeDeploymentStatus
} from "@daoflow/shared";
import { db } from "../connection";
import { deployments, deploymentSteps } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { and, eq, inArray } from "drizzle-orm";
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
      serviceByKey: new Map<string, typeof services.$inferSelect>()
    };
  }

  const projectIds = [...new Set(deploymentRows.map((row) => row.projectId))];
  const environmentIds = [...new Set(deploymentRows.map((row) => row.environmentId))];
  const serverIds = [...new Set(deploymentRows.map((row) => row.targetServerId))];

  const [projectRows, environmentRows, serverRows, serviceRows] = await Promise.all([
    db.select().from(projects).where(inArray(projects.id, projectIds)),
    db.select().from(environments).where(inArray(environments.id, environmentIds)),
    db.select().from(servers).where(inArray(servers.id, serverIds)),
    db.select().from(services).where(inArray(services.environmentId, environmentIds))
  ]);

  return {
    projectById: new Map(projectRows.map((row) => [row.id, row])),
    environmentById: new Map(environmentRows.map((row) => [row.id, row])),
    serverById: new Map(serverRows.map((row) => [row.id, row])),
    serviceByKey: new Map(
      serviceRows.map((row) => [`${row.projectId}:${row.environmentId}:${row.name}`, row] as const)
    )
  };
}

export function buildDeploymentView(
  deployment: typeof deployments.$inferSelect,
  project: typeof projects.$inferSelect | undefined,
  environment: typeof environments.$inferSelect | undefined,
  server: typeof servers.$inferSelect | undefined,
  service: typeof services.$inferSelect | undefined,
  steps: (typeof deploymentSteps.$inferSelect)[]
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
