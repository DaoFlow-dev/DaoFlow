import { and, eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import { auditEntries, events } from "../../../db/schema/audit";
import { backupRuns } from "../../../db/schema/storage";
import { newId } from "../../../db/services/json-helpers";
import type { BackupRunResult } from "./backup-activity-types";

export async function createBackupRun(
  policyId: string,
  triggeredBy: string,
  requestedRunId?: string
): Promise<string> {
  const runId = requestedRunId ?? newId();
  const now = new Date();

  if (requestedRunId) {
    const [existingRun] = await db
      .select()
      .from(backupRuns)
      .where(eq(backupRuns.id, requestedRunId))
      .limit(1);

    if (existingRun) {
      await db
        .update(backupRuns)
        .set({
          policyId,
          status: "running",
          triggeredByUserId: triggeredBy === "scheduler" ? null : triggeredBy,
          logEntries: [],
          error: null,
          artifactPath: null,
          sizeBytes: null,
          checksum: null,
          artifactFormat: null,
          databaseEngineVersion: null,
          databaseImageReference: null,
          artifactCheckedAt: null,
          verifiedAt: null,
          startedAt: now,
          completedAt: null
        })
        .where(eq(backupRuns.id, requestedRunId));

      return requestedRunId;
    }
  }

  await db.insert(backupRuns).values({
    id: runId,
    policyId,
    status: "running",
    triggeredByUserId: triggeredBy === "scheduler" ? null : triggeredBy,
    logEntries: [],
    startedAt: now,
    createdAt: now
  });

  return runId;
}

export async function markBackupRunSucceeded(
  runId: string,
  artifactPath: string,
  sizeBytes: number,
  metadata?: Pick<
    BackupRunResult,
    "checksum" | "artifactFormat" | "databaseEngineVersion" | "databaseImageReference"
  >
): Promise<void> {
  await db
    .update(backupRuns)
    .set({
      status: "succeeded",
      artifactPath,
      sizeBytes: String(sizeBytes),
      checksum: metadata?.checksum ?? null,
      artifactFormat: metadata?.artifactFormat ?? null,
      databaseEngineVersion: metadata?.databaseEngineVersion ?? null,
      databaseImageReference: metadata?.databaseImageReference ?? null,
      completedAt: new Date()
    })
    .where(eq(backupRuns.id, runId));
}

export async function markBackupRunFailed(runId: string, error: string): Promise<void> {
  await db
    .update(backupRuns)
    .set({
      status: "failed",
      error,
      completedAt: new Date()
    })
    .where(eq(backupRuns.id, runId));
}

export async function emitBackupEvent(
  policyId: string,
  kind: string,
  summary: string,
  detail: string,
  severity: "info" | "error" = "info"
): Promise<void> {
  await db.insert(events).values({
    kind,
    resourceType: "backup-policy",
    resourceId: policyId,
    summary,
    detail,
    severity,
    metadata: { actorLabel: "temporal-backup-worker" },
    createdAt: new Date()
  });
}

export async function auditBackupAction(
  policyId: string,
  action: string,
  detail: string,
  outcome: "success" | "failure" = "success"
): Promise<void> {
  await db.insert(auditEntries).values({
    actorType: "system",
    actorId: "temporal-backup-worker",
    actorEmail: "system@daoflow.local",
    actorRole: "admin",
    targetResource: `backup-policy/${policyId}`,
    action,
    inputSummary: detail,
    permissionScope: "backup:run",
    outcome,
    metadata: {
      resourceType: "backup-policy",
      resourceId: policyId,
      resourceLabel: policyId,
      detail
    }
  });
}

export async function checkBackupLock(
  policyId: string
): Promise<{ locked: boolean; conflictingRunId?: string }> {
  const inProgress = await db
    .select({ id: backupRuns.id })
    .from(backupRuns)
    .where(and(eq(backupRuns.policyId, policyId), eq(backupRuns.status, "running")))
    .limit(1);

  if (inProgress.length > 0) {
    return { locked: true, conflictingRunId: inProgress[0].id };
  }

  return { locked: false };
}
