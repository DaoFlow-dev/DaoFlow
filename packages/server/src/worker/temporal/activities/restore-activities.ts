/**
 * restore-activities.ts
 *
 * Temporal activities for backup restore operations. Handles:
 * - Downloading backup artifacts from rclone destinations
 * - Decrypting encrypted backups (rclone-crypt, archive-7z, archive-zip)
 * - Restoring to target volumes or databases
 * - Test restore for integrity verification
 */

import { eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import { backupRuns, backupRestores } from "../../../db/schema/storage";
import { backupPolicies } from "../../../db/schema/storage";
import { backupDestinations } from "../../../db/schema/destinations";
import { events, auditEntries } from "../../../db/schema/audit";
import { copyFromRemote, type DestinationConfig } from "../../rclone-executor";
import type { BackupProvider } from "../../../db/schema/destinations";
import { newId } from "../../../db/services/json-helpers";

// ── Types ────────────────────────────────────────────────────

export interface RestoreInput {
  backupRunId: string;
  /** Target path to restore to (optional, defaults to original volume path) */
  targetPath?: string;
  /** Who triggered the restore */
  triggeredBy: string;
  /** If true, restore to a temp path and verify, then cleanup */
  testRestore?: boolean;
}

export interface RestoreResolved {
  restoreId: string;
  runId: string;
  artifactPath: string;
  destination: DestinationConfig;
  targetPath: string;
  encryptionMode: string;
  backupType: string;
  databaseEngine?: string;
  containerName?: string;
}

export interface RestoreResult {
  restoreId: string;
  success: boolean;
  bytesRestored: number;
  error?: string;
}

// ── Activities ───────────────────────────────────────────────

/**
 * Resolve a backup run and prepare restoration context.
 * Validates the run exists, has an artifact, and resolves destination config.
 */
export async function resolveRestoreContext(input: RestoreInput): Promise<RestoreResolved | null> {
  // Fetch the backup run
  const [run] = await db
    .select()
    .from(backupRuns)
    .where(eq(backupRuns.id, input.backupRunId))
    .limit(1);

  if (!run || !run.artifactPath || run.status !== "succeeded") {
    return null;
  }

  // Fetch the policy to get destination and backup type info
  const [policy] = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, run.policyId))
    .limit(1);

  if (!policy || !policy.destinationId) return null;

  // Fetch destination
  const [dest] = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, policy.destinationId))
    .limit(1);

  if (!dest) return null;

  // Create restore record
  const restoreId = newId();
  await db.insert(backupRestores).values({
    id: restoreId,
    backupRunId: run.id,
    status: "running",
    targetPath: input.targetPath ?? null,
    triggeredByUserId: input.triggeredBy === "system" ? null : input.triggeredBy,
    startedAt: new Date(),
    createdAt: new Date()
  });

  return {
    restoreId,
    runId: run.id,
    artifactPath: run.artifactPath,
    destination: {
      id: dest.id,
      provider: dest.provider as BackupProvider,
      accessKey: dest.accessKey,
      secretAccessKey: dest.secretAccessKey,
      endpoint: dest.endpoint,
      region: dest.region,
      bucket: dest.bucket,
      oauthToken: dest.oauthToken,
      rcloneConfig: dest.rcloneConfig,
      localPath: dest.localPath,
      encryptionMode: dest.encryptionMode,
      encryptionPassword: dest.encryptionPassword,
      encryptionSalt: dest.encryptionSalt,
      filenameEncryption: dest.filenameEncryption
    },
    targetPath: input.targetPath ?? "/tmp/daoflow-restore",
    encryptionMode: dest.encryptionMode,
    backupType: policy.backupType ?? "volume",
    databaseEngine: policy.databaseEngine ?? undefined,
    containerName: undefined // TODO: resolve from volume metadata
  };
}

/**
 * Download backup artifact from remote destination.
 * Handles rclone-crypt transparent decryption automatically.
 * For archive-7z/zip, the artifact is downloaded as-is and must be
 * decrypted in a separate step.
 */
export async function downloadBackupArtifact(
  ctx: RestoreResolved
): Promise<{ success: boolean; localPath: string; error?: string }> {
  const localPath = `${ctx.targetPath}/${ctx.runId}`;

  // Synchronous rclone call wrapped for Temporal activity compatibility
  const result = await Promise.resolve(
    copyFromRemote(ctx.destination, ctx.artifactPath, localPath)
  );

  if (!result.success) {
    return {
      success: false,
      localPath,
      error: result.error ?? result.output
    };
  }

  return { success: true, localPath };
}

/**
 * Mark a restore as succeeded.
 */
export async function markRestoreSucceeded(restoreId: string): Promise<void> {
  await db
    .update(backupRestores)
    .set({
      status: "succeeded",
      completedAt: new Date()
    })
    .where(eq(backupRestores.id, restoreId));
}

/**
 * Mark a restore as failed.
 */
export async function markRestoreFailed(restoreId: string, error: string): Promise<void> {
  await db
    .update(backupRestores)
    .set({
      status: "failed",
      error,
      completedAt: new Date()
    })
    .where(eq(backupRestores.id, restoreId));
}

/**
 * Update the backup run's verifiedAt timestamp after a successful test restore.
 * Task #22: Records the test-restore verification timestamp.
 */
export async function markBackupVerified(runId: string): Promise<void> {
  await db.update(backupRuns).set({ verifiedAt: new Date() }).where(eq(backupRuns.id, runId));
}

/**
 * Emit a restore event to the operations timeline.
 */
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

/**
 * Audit a restore action.
 */
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
