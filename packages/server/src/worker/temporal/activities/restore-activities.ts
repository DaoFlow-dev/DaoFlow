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
import { rmSync } from "node:fs";
import { db } from "../../../db/connection";
import { backupPolicies, backupRestores, backupRuns, volumes } from "../../../db/schema/storage";
import { events, auditEntries } from "../../../db/schema/audit";
import { copyFromRemote } from "../../rclone-executor";
import { newId } from "../../../db/services/json-helpers";
import { resolveTeamScopedDestinationForVolume } from "../../../db/services/backup-resource-team";
import { decryptDestinationForVolumeOperation } from "./destination-operation";
import { executeRestoreArtifact, type RestoreExecutionContext } from "./restore-execution";

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
  /** Non-secret reference; credentials are loaded only by restore activities. */
  destinationId: string;
  volumeId: string;
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

  const destinationScope = await resolveTeamScopedDestinationForVolume(
    volume,
    policy.destinationId
  );
  if (!destinationScope) return null;
  const { destination } = destinationScope;

  const backupType = policy.backupType ?? "volume";
  const volumeMetadata = volume.metadata;
  const restoreId = input.restoreId ?? newId();
  const targetPath = input.testRestore
    ? (input.targetPath ?? `/tmp/daoflow-restore/${run.id}`)
    : (input.targetPath ?? volume.mountPath);
  const archiveEncrypted =
    destination.encryptionMode === "archive-7z" || destination.encryptionMode === "archive-zip";
  const downloadPath =
    backupType === "database" || input.testRestore || archiveEncrypted
      ? `/tmp/daoflow-restore/${restoreId}/download`
      : targetPath;
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
    destinationId: destination.id,
    volumeId: volume.id,
    targetPath,
    downloadPath,
    encryptionMode: destination.encryptionMode,
    backupType,
    volumeName: volume.name,
    serviceName: readMetadataString(volumeMetadata, "serviceName"),
    databaseEngine: policy.databaseEngine ?? undefined,
    containerName: readMetadataString(volumeMetadata, "containerName"),
    databaseName: readMetadataString(volumeMetadata, "databaseName"),
    databaseUser: readMetadataString(volumeMetadata, "databaseUser")
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
  const destination = await decryptDestinationForVolumeOperation({
    volumeId: ctx.volumeId,
    destinationId: ctx.destinationId
  });

  // Synchronous rclone call wrapped for Temporal activity compatibility
  const result = await Promise.resolve(copyFromRemote(destination, ctx.artifactPath, localPath));

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
  const executionContext: RestoreExecutionContext = {
    ...ctx,
    destination: await decryptDestinationForVolumeOperation({
      volumeId: ctx.volumeId,
      destinationId: ctx.destinationId
    }),
    databasePassword: await readDatabasePassword(ctx.volumeId)
  };
  const result = await executeRestoreArtifact(executionContext, download.localPath);

  return {
    restoreId: ctx.restoreId,
    success: result.success,
    bytesRestored: result.bytesRestored,
    error: result.error
  };
}

export function cleanupRestoreDownload(
  ctx: Pick<RestoreResolved, "downloadPath" | "targetPath">
): Promise<void> {
  if (ctx.downloadPath !== ctx.targetPath) {
    try {
      rmSync(ctx.downloadPath, { recursive: true, force: true });
    } catch {
      console.warn(`[restore] Could not clean up download path ${ctx.downloadPath}`);
    }
  }
  return Promise.resolve();
}

async function readDatabasePassword(volumeId: string): Promise<string | undefined> {
  const [volume] = await db.select().from(volumes).where(eq(volumes.id, volumeId)).limit(1);
  if (!volume) {
    throw new Error("Backup volume is no longer available.");
  }

  return readMetadataString(volume.metadata, "databasePassword");
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
