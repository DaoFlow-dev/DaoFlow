import { desc, eq, inArray, lte } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { resolveOperationalMaintenancePollIntervalMs } from "../../operational-maintenance-config";
import { readComposePreviewConfigFromConfig } from "../../compose-preview";
import {
  INCOMPLETE_UPLOADED_ARTIFACT_RETENTION_MS,
  UPLOADED_ARTIFACT_RETENTION_MS,
  listUploadedArtifactRetentionCandidates,
  pruneUploadedArtifacts
} from "../../worker/uploaded-artifacts";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";
import { cliAuthRequests } from "../schema/cli-auth";
import { services } from "../schema/services";
import { REQUEST_TTL_MS, cleanupExpiredCliAuthRequests } from "./cli-auth-requests";
import { listComposePreviewReconciliationForServiceId } from "./compose-preview-reconciliation";
import {
  listDeploymentWatchdogCandidates,
  resolveDeploymentWatchdogTimeoutMs,
  runDeploymentWatchdogOnce
} from "./deployment-watchdog";
import { triggerDeploy } from "./trigger-deploy";

const DEFAULT_PREVIEW_CLEANUP_BATCH_LIMIT = 20;
const MAX_PREVIEW_CLEANUP_BATCH_LIMIT = 100;
const MAINTENANCE_ACTIONS = [
  "maintenance.cleanup.run",
  "maintenance.cleanup.monitor",
  "maintenance.cleanup.dry_run"
] as const;
const MAINTENANCE_RESOURCE_ID = "operational-maintenance";

export interface PreviewCleanupCandidate {
  serviceId: string;
  serviceName: string;
  previewKey: string;
  target: "branch" | "pull-request";
  branch: string;
  pullRequestNumber: number | null;
  staleAt: string | null;
  staleReason: string | null;
  lastRequestedAt: string;
  stackName: string;
}

export interface OperationalMaintenanceActor {
  requestedByUserId?: string | null;
  requestedByEmail?: string | null;
  requestedByRole?: AppRole | null;
}

export function resolveOperationalMaintenancePreviewBatchLimit(
  rawValue = process.env.OPERATIONAL_MAINTENANCE_PREVIEW_BATCH_LIMIT
): number {
  const parsed = Number(rawValue ?? DEFAULT_PREVIEW_CLEANUP_BATCH_LIMIT);
  if (!Number.isFinite(parsed) || parsed < 1) {
    return DEFAULT_PREVIEW_CLEANUP_BATCH_LIMIT;
  }

  return Math.min(MAX_PREVIEW_CLEANUP_BATCH_LIMIT, Math.floor(parsed));
}

async function listPreviewCleanupCandidates(now = new Date(), limit?: number) {
  const serviceRows = await db
    .select({
      id: services.id,
      name: services.name,
      config: services.config
    })
    .from(services)
    .where(eq(services.sourceType, "compose"));

  const previewEnabledServices = serviceRows.filter((service) =>
    readComposePreviewConfigFromConfig(service.config)
  );
  const candidates: PreviewCleanupCandidate[] = [];

  for (const service of previewEnabledServices) {
    const report = await listComposePreviewReconciliationForServiceId({
      serviceId: service.id,
      now
    });

    for (const preview of report.previews) {
      if (!preview.gcEligible) {
        continue;
      }

      candidates.push({
        serviceId: service.id,
        serviceName: report.service.name,
        previewKey: preview.key,
        target: preview.target,
        branch: preview.branch,
        pullRequestNumber: preview.pullRequestNumber,
        staleAt: preview.staleAt,
        staleReason: preview.staleReason,
        lastRequestedAt: preview.lastRequestedAt,
        stackName: preview.stackName
      });
    }
  }

  candidates.sort((left, right) => left.lastRequestedAt.localeCompare(right.lastRequestedAt));

  return {
    previewEnabledServices: previewEnabledServices.length,
    totalCandidates: candidates.length,
    candidates: candidates.slice(0, limit ?? resolveOperationalMaintenancePreviewBatchLimit())
  };
}

async function readLatestOperationalMaintenanceEntry() {
  const [entry] = await db
    .select()
    .from(auditEntries)
    .where(inArray(auditEntries.action, [...MAINTENANCE_ACTIONS]))
    .orderBy(desc(auditEntries.createdAt))
    .limit(1);

  if (!entry) {
    return null;
  }

  return {
    action: entry.action,
    actorEmail: entry.actorEmail,
    actorId: entry.actorId,
    outcome: entry.outcome,
    summary: entry.inputSummary ?? "",
    createdAt: entry.createdAt.toISOString(),
    metadata: entry.metadata
  };
}

function buildSummaryText(input: {
  dryRun: boolean;
  stalledDeployments: number;
  stalePreviews: number;
  expiredCliAuthRequests: number;
  retainedArtifacts: number;
}) {
  const parts = [
    `${input.stalledDeployments} stalled deployment${input.stalledDeployments === 1 ? "" : "s"}`,
    `${input.stalePreviews} stale preview${input.stalePreviews === 1 ? "" : "s"}`,
    `${input.expiredCliAuthRequests} expired CLI sign-in${input.expiredCliAuthRequests === 1 ? "" : "s"}`,
    `${input.retainedArtifacts} retained artifact${input.retainedArtifacts === 1 ? "" : "s"}`
  ];

  return input.dryRun
    ? `Dry run found ${parts.join(", ")} eligible for cleanup.`
    : `Cleanup processed ${parts.join(", ")}.`;
}

export async function getOperationalMaintenanceReport(input?: { now?: Date }) {
  const now = input?.now ?? new Date();
  const [watchdogCandidates, previewCandidates, artifactCandidates, latestRun, expiredCliAuthRows] =
    await Promise.all([
      listDeploymentWatchdogCandidates({ now, limit: 20 }),
      listPreviewCleanupCandidates(now),
      listUploadedArtifactRetentionCandidates(now),
      readLatestOperationalMaintenanceEntry(),
      db
        .select({ id: cliAuthRequests.id })
        .from(cliAuthRequests)
        .where(lte(cliAuthRequests.expiresAt, now))
    ]);

  return {
    generatedAt: now.toISOString(),
    defaults: {
      cleanupIntervalMs: resolveOperationalMaintenancePollIntervalMs(),
      previewCleanupBatchLimit: resolveOperationalMaintenancePreviewBatchLimit(),
      deploymentWatchdogTimeoutMs: resolveDeploymentWatchdogTimeoutMs(),
      cliAuthRequestTtlMs: REQUEST_TTL_MS,
      retainedArtifactWindowMs: UPLOADED_ARTIFACT_RETENTION_MS,
      incompleteUploadWindowMs: INCOMPLETE_UPLOADED_ARTIFACT_RETENTION_MS
    },
    current: {
      stalledDeployments: {
        eligibleCount: watchdogCandidates.length,
        items: watchdogCandidates
      },
      stalePreviews: {
        previewEnabledServices: previewCandidates.previewEnabledServices,
        eligibleCount: previewCandidates.totalCandidates,
        items: previewCandidates.candidates
      },
      expiredCliAuthRequests: {
        eligibleCount: expiredCliAuthRows.length
      },
      retainedArtifacts: {
        eligibleCount: artifactCandidates.length,
        retainedArtifacts: artifactCandidates.filter(
          (candidate) => candidate.kind === "retained-artifact"
        ).length,
        incompleteUploads: artifactCandidates.filter(
          (candidate) => candidate.kind === "incomplete-upload"
        ).length,
        items: artifactCandidates.slice(0, 20)
      }
    },
    latestRun
  };
}

export async function runOperationalMaintenanceOnce(
  input?: OperationalMaintenanceActor & {
    dryRun?: boolean;
    now?: Date;
    trigger?: "manual" | "monitor";
  }
) {
  const now = input?.now ?? new Date();
  const dryRun = input?.dryRun === true;
  const trigger = input?.trigger ?? "manual";
  const previewBatchLimit = resolveOperationalMaintenancePreviewBatchLimit();
  const [watchdogCandidates, previewCandidates, artifactCandidates] = await Promise.all([
    listDeploymentWatchdogCandidates({ now, limit: 20 }),
    listPreviewCleanupCandidates(now, previewBatchLimit),
    listUploadedArtifactRetentionCandidates(now)
  ]);

  const result = {
    generatedAt: now.toISOString(),
    dryRun,
    trigger,
    stalledDeployments: {
      eligibleCount: watchdogCandidates.length,
      failedCount: 0
    },
    stalePreviews: {
      previewEnabledServices: previewCandidates.previewEnabledServices,
      eligibleCount: previewCandidates.totalCandidates,
      queuedCount: 0,
      queuedDeployments: [] as Array<{ previewKey: string; deploymentId: string }>,
      failures: [] as Array<{ previewKey: string; message: string }>
    },
    expiredCliAuthRequests: {
      eligibleCount: 0,
      deletedCount: 0
    },
    retainedArtifacts: {
      eligibleCount: artifactCandidates.length,
      prunedCount: 0,
      prunedRetainedArtifacts: 0,
      prunedIncompleteUploads: 0
    }
  };

  result.expiredCliAuthRequests.eligibleCount = (
    await db
      .select({ id: cliAuthRequests.id })
      .from(cliAuthRequests)
      .where(lte(cliAuthRequests.expiresAt, now))
  ).length;

  if (!dryRun) {
    const [watchdogRun, deletedCliAuthRequests, prunedArtifacts] = await Promise.all([
      runDeploymentWatchdogOnce({ now }),
      cleanupExpiredCliAuthRequests(now),
      pruneUploadedArtifacts(now)
    ]);

    result.stalledDeployments.failedCount = watchdogRun.failedCount;
    result.expiredCliAuthRequests.deletedCount = deletedCliAuthRequests;
    result.retainedArtifacts.prunedCount = prunedArtifacts.prunedArtifacts;
    result.retainedArtifacts.prunedRetainedArtifacts = prunedArtifacts.prunedRetainedArtifacts;
    result.retainedArtifacts.prunedIncompleteUploads = prunedArtifacts.prunedIncompleteUploads;

    for (const preview of previewCandidates.candidates) {
      const queued = await triggerDeploy({
        serviceId: preview.serviceId,
        preview: {
          target: preview.target,
          branch: preview.branch,
          pullRequestNumber: preview.pullRequestNumber ?? undefined,
          action: "destroy"
        },
        requestedByUserId: input?.requestedByUserId ?? null,
        requestedByEmail: input?.requestedByEmail ?? "system@daoflow.local",
        requestedByRole: input?.requestedByRole ?? "admin",
        trigger: "api"
      });

      if (queued.status === "ok" && queued.deployment) {
        result.stalePreviews.queuedCount += 1;
        result.stalePreviews.queuedDeployments.push({
          previewKey: preview.previewKey,
          deploymentId: queued.deployment.id
        });
        continue;
      }

      result.stalePreviews.failures.push({
        previewKey: preview.previewKey,
        message: queued.message ?? `Failed to queue cleanup (${queued.status}).`
      });
    }
  }

  const summary = buildSummaryText({
    dryRun,
    stalledDeployments: dryRun
      ? result.stalledDeployments.eligibleCount
      : result.stalledDeployments.failedCount,
    stalePreviews: dryRun ? result.stalePreviews.eligibleCount : result.stalePreviews.queuedCount,
    expiredCliAuthRequests: dryRun
      ? result.expiredCliAuthRequests.eligibleCount
      : result.expiredCliAuthRequests.deletedCount,
    retainedArtifacts: dryRun
      ? result.retainedArtifacts.eligibleCount
      : result.retainedArtifacts.prunedCount
  });

  const changedCount =
    result.stalledDeployments.failedCount +
    result.stalePreviews.queuedCount +
    result.expiredCliAuthRequests.deletedCount +
    result.retainedArtifacts.prunedCount;
  const shouldRecordAudit =
    dryRun || trigger === "manual" || changedCount > 0 || result.stalePreviews.failures.length > 0;

  if (shouldRecordAudit) {
    await db.insert(auditEntries).values({
      actorType: input?.requestedByUserId ? "user" : "system",
      actorId: input?.requestedByUserId ?? "system:maintenance",
      actorEmail: input?.requestedByEmail ?? "system@daoflow.local",
      actorRole: input?.requestedByRole ?? "admin",
      targetResource: `system/${MAINTENANCE_RESOURCE_ID}`,
      action: dryRun
        ? "maintenance.cleanup.dry_run"
        : trigger === "monitor"
          ? "maintenance.cleanup.monitor"
          : "maintenance.cleanup.run",
      inputSummary: summary,
      permissionScope: "server:write",
      outcome: result.stalePreviews.failures.length > 0 ? "partial" : "success",
      metadata: result
    });
  }

  if (!dryRun && (changedCount > 0 || result.stalePreviews.failures.length > 0)) {
    await db.insert(events).values({
      kind: "maintenance.cleanup.completed",
      resourceType: "system",
      resourceId: MAINTENANCE_RESOURCE_ID,
      summary: "Operational maintenance cycle completed.",
      detail: summary,
      severity: result.stalePreviews.failures.length > 0 ? "warning" : "info",
      metadata: result,
      createdAt: now
    });
  }

  return {
    ...result,
    summary
  };
}
