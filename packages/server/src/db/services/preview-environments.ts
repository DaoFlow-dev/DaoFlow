import { and, desc, eq, inArray } from "drizzle-orm";
import {
  formatDeploymentStatusLabel,
  getDeploymentStatusTone,
  normalizeDeploymentStatus
} from "@daoflow/shared";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { previewEnvironments } from "../schema/preview-environments";
import { services } from "../schema/services";
import { asRecord, newId } from "./json-helpers";
import {
  readComposePreviewConfigFromConfig,
  readComposePreviewMetadata,
  type ComposePreviewMetadata,
  type ComposePreviewTarget
} from "../../compose-preview";
import { resolveServiceForUser } from "./scoped-services";
import {
  deploymentFinishedAt,
  displayStatusForRow,
  toCleanupStatus,
  toPreviewStatus
} from "./preview-environment-status";

type PreviewEnvironmentRow = typeof previewEnvironments.$inferSelect;
type DeploymentRow = typeof deployments.$inferSelect;
type ServiceRow = typeof services.$inferSelect;

function isActivePreviewStatus(status: string) {
  return status === "active" || status === "stale";
}

function toHistoryRecord(row: PreviewEnvironmentRow, deployment: DeploymentRow | null) {
  const status = displayStatusForRow(row);
  const latestAction: "deploy" | "destroy" =
    row.lastDeploymentAction === "destroy" ? "destroy" : "deploy";
  const latestStatus = normalizeDeploymentStatus(
    row.lastDeploymentStatus ?? deployment?.status ?? "queued",
    row.lastDeploymentConclusion ?? deployment?.conclusion ?? null
  );

  const target: ComposePreviewTarget = row.target === "branch" ? "branch" : "pull-request";

  return {
    id: row.id,
    key: row.previewKey,
    target,
    branch: row.branch,
    pullRequestNumber: row.pullRequestNumber,
    envBranch: row.envBranch,
    stackName: row.stackName,
    primaryDomain: row.primaryDomain,
    status,
    cleanupStatus: row.cleanupStatus,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString(),
    lastSeenAt: row.lastSeenAt.toISOString(),
    cleanupRequestedAt: row.cleanupRequestedAt?.toISOString() ?? null,
    cleanupCompletedAt: row.cleanupCompletedAt?.toISOString() ?? null,
    latestDeploymentId: row.lastDeploymentId ?? deployment?.id ?? "",
    latestAction,
    latestStatus,
    latestStatusLabel: formatDeploymentStatusLabel(
      row.lastDeploymentStatus ?? deployment?.status ?? "queued",
      row.lastDeploymentConclusion ?? deployment?.conclusion ?? null
    ),
    latestStatusTone: getDeploymentStatusTone(
      row.lastDeploymentStatus ?? deployment?.status ?? "queued",
      row.lastDeploymentConclusion ?? deployment?.conclusion ?? null
    ),
    lastRequestedAt: (row.lastDeploymentAt ?? row.createdAt).toISOString(),
    lastFinishedAt: deploymentFinishedAt(deployment),
    isActive: isActivePreviewStatus(status),
    latestDeployment: deployment
  };
}

async function loadLatestDeployments(rows: PreviewEnvironmentRow[]) {
  const deploymentIds = rows
    .map((row) => row.lastDeploymentId)
    .filter((id): id is string => typeof id === "string" && id.length > 0);
  if (deploymentIds.length === 0) {
    return new Map<string, DeploymentRow>();
  }

  const deploymentRows = await db
    .select()
    .from(deployments)
    .where(inArray(deployments.id, deploymentIds));
  return new Map(deploymentRows.map((row) => [row.id, row]));
}

export async function recordPreviewEnvironmentDeployment(input: {
  service: ServiceRow;
  teamId: string;
  metadata: ComposePreviewMetadata;
  deployment: DeploymentRow;
  providerType?: string | null;
  configInventory?: unknown;
}) {
  const action = input.metadata.action;
  const now = new Date();
  const status = toPreviewStatus({ action, deploymentStatus: input.deployment.status });
  const cleanupStatus = toCleanupStatus({ action, deploymentStatus: input.deployment.status });

  const [row] = await db
    .insert(previewEnvironments)
    .values({
      id: newId(),
      teamId: input.teamId,
      projectId: input.service.projectId,
      environmentId: input.service.environmentId,
      serviceId: input.service.id,
      providerType: input.providerType ?? "manual",
      previewKey: input.metadata.key,
      target: input.metadata.target,
      branch: input.metadata.branch,
      pullRequestNumber: input.metadata.pullRequestNumber,
      envBranch: input.metadata.envBranch,
      stackName: input.metadata.stackName,
      primaryDomain: input.metadata.primaryDomain,
      status,
      cleanupStatus,
      lastDeploymentId: input.deployment.id,
      lastDeploymentStatus: input.deployment.status,
      lastDeploymentConclusion: input.deployment.conclusion,
      lastDeploymentAction: action,
      lastDeploymentAt: input.deployment.createdAt,
      lastSeenAt: now,
      cleanupRequestedAt: action === "destroy" ? now : null,
      cleanupDeploymentId: action === "destroy" ? input.deployment.id : null,
      metadata: {
        configInventory: input.configInventory ?? null
      },
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: [previewEnvironments.serviceId, previewEnvironments.previewKey],
      set: {
        providerType: input.providerType ?? "manual",
        target: input.metadata.target,
        branch: input.metadata.branch,
        pullRequestNumber: input.metadata.pullRequestNumber,
        envBranch: input.metadata.envBranch,
        stackName: input.metadata.stackName,
        primaryDomain: input.metadata.primaryDomain,
        status,
        cleanupStatus,
        lastDeploymentId: input.deployment.id,
        lastDeploymentStatus: input.deployment.status,
        lastDeploymentConclusion: input.deployment.conclusion,
        lastDeploymentAction: action,
        lastDeploymentAt: input.deployment.createdAt,
        lastSeenAt: now,
        cleanupRequestedAt: action === "destroy" ? now : null,
        cleanupCompletedAt: null,
        cleanupDeploymentId: action === "destroy" ? input.deployment.id : null,
        metadata: {
          configInventory: input.configInventory ?? null
        },
        updatedAt: now
      }
    })
    .returning();

  return row;
}

export async function syncPreviewEnvironmentDeploymentStatus(deployment: DeploymentRow) {
  const preview = readComposePreviewMetadata(asRecord(deployment.configSnapshot).preview);
  if (!preview) {
    return null;
  }

  const status = toPreviewStatus({
    action: preview.action,
    deploymentStatus: deployment.status,
    deploymentConclusion: deployment.conclusion
  });
  const cleanupStatus = toCleanupStatus({
    action: preview.action,
    deploymentStatus: deployment.status,
    deploymentConclusion: deployment.conclusion
  });
  const now = new Date();
  const [updated] = await db
    .update(previewEnvironments)
    .set({
      status,
      cleanupStatus,
      lastDeploymentStatus: deployment.status,
      lastDeploymentConclusion: deployment.conclusion,
      cleanupCompletedAt: cleanupStatus === "completed" ? now : null,
      updatedAt: now
    })
    .where(eq(previewEnvironments.lastDeploymentId, deployment.id))
    .returning();

  return updated ?? null;
}

export async function markPreviewEnvironmentsStale(input: {
  serviceId: string;
  previewKeys: string[];
  staleAtByKey: Map<string, string>;
}) {
  if (input.previewKeys.length === 0) {
    return;
  }

  const now = new Date();
  for (const previewKey of input.previewKeys) {
    const staleAt = input.staleAtByKey.get(previewKey);
    await db
      .update(previewEnvironments)
      .set({
        status: "stale",
        staleAt: staleAt ? new Date(staleAt) : now,
        updatedAt: now
      })
      .where(
        and(
          eq(previewEnvironments.serviceId, input.serviceId),
          eq(previewEnvironments.previewKey, previewKey)
        )
      );
  }
}

export async function loadDurableComposePreviewHistoryForService(service: ServiceRow) {
  const rows = await db
    .select()
    .from(previewEnvironments)
    .where(eq(previewEnvironments.serviceId, service.id))
    .orderBy(desc(previewEnvironments.lastDeploymentAt), desc(previewEnvironments.createdAt));
  const deploymentsById = await loadLatestDeployments(rows);

  return {
    service: {
      id: service.id,
      name: service.name,
      environmentId: service.environmentId,
      projectId: service.projectId,
      config: service.config,
      previewConfig: readComposePreviewConfigFromConfig(service.config)
    },
    previews: rows.map((row) =>
      toHistoryRecord(row, deploymentsById.get(row.lastDeploymentId ?? "") ?? null)
    )
  };
}

export async function loadDurableComposePreviewHistory(input: {
  serviceRef: string;
  requestedByUserId: string;
}) {
  const service = await resolveServiceForUser(input.serviceRef, input.requestedByUserId);
  return loadDurableComposePreviewHistoryForService(service);
}
