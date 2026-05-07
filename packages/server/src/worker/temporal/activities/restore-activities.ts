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
import { backupPolicies, backupRestores, backupRuns, volumes } from "../../../db/schema/storage";
import { backupDestinations } from "../../../db/schema/destinations";
import { events, auditEntries } from "../../../db/schema/audit";
import { copyFromRemote, type DestinationConfig } from "../../rclone-executor";
import type { BackupProvider } from "../../../db/schema/destinations";
import { newId } from "../../../db/services/json-helpers";
import { executeRestoreArtifact } from "./restore-execution";

// ── Types ────────────────────────────────────────────────────

export interface RestoreInput {
  restoreId?: string;
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
  downloadPath: string;
  encryptionMode: string;
  backupType: string;
  volumeName: string;
  serviceName?: string;
  databaseEngine?: string;
  containerName?: string;
  databaseName?: string;
  databaseUser?: string;
  databasePassword?: string;
}

export interface RestoreResult {
  restoreId: string;
  success: boolean;
  bytesRestored: number;
  error?: string;
}

function readMetadataString(metadata: unknown, key: string): string | undefined {
  if (!metadata || typeof metadata !== "object" || Array.isArray(metadata)) {
    return undefined;
  }

  const value = (metadata as Record<string, unknown>)[key];
  return typeof value === "string" && value.trim().length > 0 ? value : undefined;
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

  const [volume] = await db.select().from(volumes).where(eq(volumes.id, policy.volumeId)).limit(1);

  if (!volume) return null;

  // Fetch destination
  const [dest] = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, policy.destinationId))
    .limit(1);

  if (!dest) return null;

  const backupType = policy.backupType ?? "volume";
  const volumeMetadata = volume.metadata;
  const targetPath = input.testRestore
    ? (input.targetPath ?? `/tmp/daoflow-restore/${run.id}`)
    : (input.targetPath ?? volume.mountPath);
  const downloadPath =
    backupType === "database" || input.testRestore ? `/tmp/daoflow-restore/${run.id}` : targetPath;
  const restoreId = input.restoreId ?? newId();
  const now = new Date();

  if (input.restoreId) {
    await db
      .update(backupRestores)
      .set({
        status: "running",
        targetPath,
        error: null,
        startedAt: now,
        completedAt: null
      })
      .where(eq(backupRestores.id, input.restoreId));
  } else {
    await db.insert(backupRestores).values({
      id: restoreId,
      backupRunId: run.id,
      status: "running",
      targetPath,
      triggeredByUserId: input.triggeredBy === "system" ? null : input.triggeredBy,
      startedAt: now,
      createdAt: now
    });
  }

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
    targetPath,
    downloadPath,
    encryptionMode: dest.encryptionMode,
    backupType,
    volumeName: volume.name,
    serviceName: readMetadataString(volumeMetadata, "serviceName"),
    databaseEngine: policy.databaseEngine ?? undefined,
    containerName: readMetadataString(volumeMetadata, "containerName"),
    databaseName: readMetadataString(volumeMetadata, "databaseName"),
    databaseUser: readMetadataString(volumeMetadata, "databaseUser"),
    databasePassword: readMetadataString(volumeMetadata, "databasePassword")
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
  const localPath = ctx.downloadPath;

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
 * Replay the downloaded backup into its real restore target.
 */
export async function executeRestore(
  ctx: RestoreResolved,
  download: { localPath: string }
): Promise<RestoreResult> {
  const result = await executeRestoreArtifact(ctx, download.localPath);

  return {
    restoreId: ctx.restoreId,
    success: result.success,
    bytesRestored: result.bytesRestored,
    error: result.error
  };
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
