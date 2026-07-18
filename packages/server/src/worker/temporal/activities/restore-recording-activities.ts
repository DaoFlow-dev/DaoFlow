import { eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import { auditEntries, events } from "../../../db/schema/audit";
import {
  backupRestores,
  backupRuns,
  type BackupVerificationResult
} from "../../../db/schema/storage";

export async function markRestoreSucceeded(
  restoreId: string,
  verificationResult?: BackupVerificationResult
): Promise<void> {
  await db
    .update(backupRestores)
    .set({
      status: "succeeded",
      verificationResult: verificationResult ?? null,
      completedAt: new Date()
    })
    .where(eq(backupRestores.id, restoreId));
}

export async function markRestoreFailed(
  restoreId: string,
  error: string,
  verificationResult?: BackupVerificationResult
): Promise<void> {
  await db
    .update(backupRestores)
    .set({
      status: "failed",
      error,
      verificationResult: verificationResult ?? null,
      completedAt: new Date()
    })
    .where(eq(backupRestores.id, restoreId));
}

export async function markBackupVerified(runId: string): Promise<void> {
  await db.update(backupRuns).set({ verifiedAt: new Date() }).where(eq(backupRuns.id, runId));
}

export async function emitRestoreEvent(
  restoreId: string,
  kind: string,
  summary: string,
  detail: string,
  severity: "info" | "error" = "info"
): Promise<void> {
  await db.insert(events).values({
    kind,
    resourceType: "backup-restore",
    resourceId: restoreId,
    summary,
    detail,
    severity,
    metadata: { actorLabel: "temporal-restore-worker" },
    createdAt: new Date()
  });
}

export async function auditRestoreAction(
  restoreId: string,
  action: string,
  detail: string,
  outcome: "success" | "failure" = "success"
): Promise<void> {
  await db.insert(auditEntries).values({
    actorType: "system",
    actorId: "temporal-restore-worker",
    actorEmail: "system@daoflow.local",
    actorRole: "admin",
    targetResource: `backup-restore/${restoreId}`,
    action,
    inputSummary: detail,
    permissionScope: "backup:restore",
    outcome,
    metadata: {
      resourceType: "backup-restore",
      resourceId: restoreId,
      resourceLabel: restoreId,
      detail
    }
  });
}
