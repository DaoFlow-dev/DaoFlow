import { and, eq, lt, sql } from "drizzle-orm";
import { db } from "../../../db/connection";
import { backupDestinations } from "../../../db/schema/destinations";
import { backupPolicies, backupRuns } from "../../../db/schema/storage";
import { checkRemote, deleteRemote } from "../../rclone-executor";
import type {
  BackupPolicyResolved,
  IntegrityCheckResult,
  StorageUsageResult
} from "./backup-activity-types";
import { emitBackupEvent } from "./backup-run-recording";

export async function applyRetentionPolicy(resolved: BackupPolicyResolved): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - resolved.retentionDays);

  const oldRuns = await db
    .select()
    .from(backupRuns)
    .where(
      and(
        eq(backupRuns.policyId, resolved.policyId),
        eq(backupRuns.status, "succeeded"),
        lt(backupRuns.createdAt, cutoffDate)
      )
    );

  let purged = 0;
  for (const run of oldRuns) {
    if (run.artifactPath) {
      try {
        deleteRemote(resolved.destination, run.artifactPath);
        purged++;
      } catch (err) {
        console.warn(`[backup] Failed to purge artifact ${run.artifactPath}:`, err);
      }
    }

    await db.update(backupRuns).set({ status: "expired" }).where(eq(backupRuns.id, run.id));
  }

  return purged;
}

export async function verifyBackupIntegrity(
  resolved: BackupPolicyResolved,
  artifactPath: string,
  runId: string
): Promise<IntegrityCheckResult> {
  const check = checkRemote(resolved.destination, artifactPath);

  if (check.success) {
    await db
      .update(backupRuns)
      .set({
        sizeBytes: String(check.totalBytes),
        verifiedAt: new Date()
      })
      .where(eq(backupRuns.id, runId));
  }

  return {
    verified: check.success,
    fileCount: check.fileCount,
    totalBytes: check.totalBytes,
    error: check.error
  };
}

export async function checkStorageQuota(destinationId: string): Promise<StorageUsageResult> {
  const [usage] = await db
    .select({
      totalBytes: sql<string>`COALESCE(SUM(CAST(${backupRuns.sizeBytes} AS BIGINT)), 0)`
    })
    .from(backupRuns)
    .innerJoin(backupPolicies, eq(backupRuns.policyId, backupPolicies.id))
    .where(
      and(eq(backupPolicies.destinationId, destinationId), eq(backupRuns.status, "succeeded"))
    );

  const totalBytes = parseInt(String(usage?.totalBytes ?? "0"), 10);
  const [dest] = await db
    .select({
      quotaBytes: backupDestinations.quotaBytes,
      quotaWarningPercent: backupDestinations.quotaWarningPercent
    })
    .from(backupDestinations)
    .where(eq(backupDestinations.id, destinationId))
    .limit(1);

  const quotaBytes = dest?.quotaBytes ? parseInt(dest.quotaBytes, 10) : null;
  const quotaWarningPercent = dest?.quotaWarningPercent ?? 80;
  const usagePercent = quotaBytes ? Math.round((totalBytes / quotaBytes) * 100) : null;
  const overWarning = usagePercent !== null && usagePercent >= quotaWarningPercent;
  const overQuota = usagePercent !== null && usagePercent >= 100;

  if (overWarning) {
    await emitBackupEvent(
      destinationId,
      overQuota ? "storage.quota.exceeded" : "storage.quota.warning",
      overQuota ? "Storage quota exceeded" : "Storage quota warning",
      `Destination ${destinationId} is at ${usagePercent}% capacity (${totalBytes} / ${quotaBytes} bytes)`,
      overQuota ? "error" : "info"
    );
  }

  return {
    destinationId,
    totalBytes,
    quotaBytes,
    quotaWarningPercent,
    usagePercent,
    overQuota,
    overWarning
  };
}
