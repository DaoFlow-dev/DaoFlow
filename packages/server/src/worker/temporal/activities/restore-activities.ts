/**
 * restore-activities.ts
 *
 * Temporal activities for backup restore operations. Handles:
 * - Downloading backup artifacts from rclone destinations
 * - Decrypting encrypted backups (rclone-crypt, archive-7z, archive-zip)
 * - Restoring to target volumes or databases
 * - Test restore for integrity verification
 */

import { and, eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import { servers } from "../../../db/schema/servers";
import {
  backupPolicies,
  backupRestores,
  backupRuns,
  volumes,
  type BackupRestoreMode,
  type BackupVerificationResult
} from "../../../db/schema/storage";
import { approvalRequests } from "../../../db/schema/audit";
import { copyFromRemoteAsync } from "../../rclone-executor";
import { newId } from "../../../db/services/json-helpers";
import {
  resolveTeamScopedDestinationForVolume,
  resolveVolumeTeamId
} from "../../../db/services/backup-resource-team";
import { decryptDestinationForVolumeOperation } from "./destination-operation";
import { executePostgresRestoreVerification } from "./postgres-restore-verification-activity";
import { isLocalRestoreHost, readRestoreMetadataString } from "./restore-context-utils";
import { executeRestoreArtifact, type RestoreExecutionContext } from "./restore-execution";
import { runWithRemoteTransferActivity } from "./remote-transfer-activity";
import { resolveVolumeSourceKind, type VolumeSourceKind } from "./volume-source-kind";
import { removeSensitiveStaging } from "./sensitive-staging-cleanup";
import type { RestoreApproval, RestoreWorkflowInput } from "../restore-workflow-input";

export {
  auditRestoreAction,
  emitRestoreEvent,
  markBackupVerified,
  markRestoreFailed,
  markRestoreSucceeded
} from "./restore-recording-activities";

// ── Types ────────────────────────────────────────────────────

export type RestoreInput = RestoreWorkflowInput;

export interface RestoreResolved {
  restoreId: string;
  runId: string;
  artifactPath: string;
  /** Non-secret reference; credentials are loaded only by restore activities. */
  destinationId: string;
  volumeId: string;
  /** Non-secret server and volume routing context for remote volume restore. */
  teamId?: string;
  serverId?: string;
  serverHost?: string;
  mountPath?: string;
  sourceKind: VolumeSourceKind;
  /** Optional because pre-upgrade workflow histories did not serialize a mode. */
  mode?: BackupRestoreMode;
  targetPath?: string;
  downloadPath: string;
  encryptionMode: string;
  backupType: string;
  volumeName: string;
  serviceName?: string;
  databaseEngine?: string;
  containerName?: string;
  databaseName?: string;
  databaseUser?: string;
  checksum?: string;
  artifactFormat?: string;
  databaseEngineVersion?: string;
  databaseImageReference?: string;
  approval?: RestoreApproval;
}

export interface RestoreResult {
  restoreId: string;
  success: boolean;
  bytesRestored: number;
  verificationResult?: BackupVerificationResult;
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

  const [volume] = await db.select().from(volumes).where(eq(volumes.id, policy.volumeId)).limit(1);

  if (!volume) return null;

  const destinationScope = await resolveTeamScopedDestinationForVolume(
    volume,
    policy.destinationId
  );
  if (!destinationScope) return null;
  const { destination, teamId } = destinationScope;

  const [server] = await db.select().from(servers).where(eq(servers.id, volume.serverId)).limit(1);
  if (!server || server.teamId !== teamId) return null;

  const backupType = policy.backupType ?? "volume";
  const volumeMetadata = volume.metadata;
  const restoreId = input.restoreId ?? newId();
  const mode = input.mode ?? (input.testRestore ? "verification" : "restore");
  const targetPath =
    mode === "verification"
      ? backupType === "database"
        ? undefined
        : (input.targetPath ?? `/tmp/daoflow-restore/${run.id}`)
      : (input.targetPath ?? volume.mountPath);
  const archiveEncrypted =
    destination.encryptionMode === "archive-7z" || destination.encryptionMode === "archive-zip";
  const remoteVolumeRestore =
    backupType === "volume" && mode === "restore" && !isLocalRestoreHost(server.host);
  const downloadPath =
    backupType === "database" || mode === "verification" || archiveEncrypted || remoteVolumeRestore
      ? `/tmp/daoflow-restore/${restoreId}/download`
      : (targetPath ?? `/tmp/daoflow-restore/${restoreId}/download`);
  const now = new Date();

  if (input.restoreId) {
    await db
      .update(backupRestores)
      .set({
        mode,
        status: "running",
        targetPath: targetPath ?? null,
        error: null,
        startedAt: now,
        completedAt: null
      })
      .where(eq(backupRestores.id, input.restoreId));
  } else {
    await db.insert(backupRestores).values({
      id: restoreId,
      backupRunId: run.id,
      mode,
      status: "running",
      targetPath: targetPath ?? null,
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
    teamId,
    serverId: volume.serverId,
    serverHost: server.host,
    mountPath: volume.mountPath,
    sourceKind: resolveVolumeSourceKind(volume.metadata),
    mode,
    targetPath,
    downloadPath,
    encryptionMode: destination.encryptionMode,
    backupType,
    volumeName: volume.name,
    serviceName: readRestoreMetadataString(volumeMetadata, "serviceName"),
    databaseEngine: policy.databaseEngine ?? undefined,
    containerName:
      mode === "restore" ? readRestoreMetadataString(volumeMetadata, "containerName") : undefined,
    databaseName:
      mode === "restore" ? readRestoreMetadataString(volumeMetadata, "databaseName") : undefined,
    databaseUser:
      mode === "restore" ? readRestoreMetadataString(volumeMetadata, "databaseUser") : undefined,
    checksum: run.checksum ?? undefined,
    artifactFormat: run.artifactFormat ?? undefined,
    databaseEngineVersion: run.databaseEngineVersion ?? undefined,
    databaseImageReference: run.databaseImageReference ?? undefined,
    approval: input.approval
  };
}

async function revalidateRestoreApproval(
  backupRunId: string,
  approval: RestoreApproval | undefined
): Promise<void> {
  if (!approval) return;

  const { approvalRequestId, expectedTeamId } = approval;
  if (!approvalRequestId || !expectedTeamId) {
    throw new Error("Restore approval binding is incomplete.");
  }

  const [approvedRequest] = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.id, approvalRequestId),
        eq(approvalRequests.teamId, expectedTeamId),
        eq(approvalRequests.actionType, "backup-restore"),
        eq(approvalRequests.targetResource, `backup-run/${backupRunId}`),
        eq(approvalRequests.status, "approved")
      )
    )
    .limit(1);
  if (!approvedRequest) {
    throw new Error("Restore approval is no longer valid for this target.");
  }

  const [run] = await db
    .select({ policyId: backupRuns.policyId })
    .from(backupRuns)
    .where(eq(backupRuns.id, backupRunId))
    .limit(1);
  if (!run) {
    throw new Error("Restore target is no longer available for approval revalidation.");
  }

  const [policy] = await db
    .select({ volumeId: backupPolicies.volumeId })
    .from(backupPolicies)
    .where(eq(backupPolicies.id, run.policyId))
    .limit(1);
  if (!policy) {
    throw new Error("Restore target is no longer available for approval revalidation.");
  }

  const [volume] = await db.select().from(volumes).where(eq(volumes.id, policy.volumeId)).limit(1);
  if (!volume || (await resolveVolumeTeamId(volume)) !== expectedTeamId) {
    throw new Error("Restore approval team no longer matches the restore target.");
  }
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
  return runWithRemoteTransferActivity(async (signal) => {
    await revalidateRestoreApproval(ctx.runId, ctx.approval);

    const localPath = ctx.downloadPath;
    const destination = await decryptDestinationForVolumeOperation({
      volumeId: ctx.volumeId,
      destinationId: ctx.destinationId
    });
    const result = await copyFromRemoteAsync(destination, ctx.artifactPath, localPath, {
      cancellationSignal: signal
    });

    if (!result.success) {
      return {
        success: false,
        localPath,
        error: result.error ?? result.output
      };
    }

    return { success: true, localPath };
  });
}

/**
 * Replay the downloaded backup into its real restore target.
 */
export async function executeRestore(
  ctx: RestoreResolved,
  download: { localPath: string }
): Promise<RestoreResult> {
  const destination = await decryptDestinationForVolumeOperation({
    volumeId: ctx.volumeId,
    destinationId: ctx.destinationId
  });
  const verificationContext = resolvePostgresRestoreVerificationContext(ctx);
  if (verificationContext) {
    return executePostgresRestoreVerification(verificationContext, destination, download.localPath);
  }

  const executionContext: RestoreExecutionContext = {
    ...ctx,
    destination,
    databasePassword:
      ctx.backupType === "database" ? await readDatabasePassword(ctx.volumeId) : undefined
  };
  const result = await runWithRemoteTransferActivity((signal) =>
    executeRestoreArtifact(executionContext, download.localPath, signal)
  );

  return {
    restoreId: ctx.restoreId,
    success: result.success,
    bytesRestored: result.bytesRestored,
    error: result.error
  };
}

function resolvePostgresRestoreVerificationContext<
  T extends Pick<RestoreResolved, "backupType" | "mode" | "targetPath">
>(ctx: T): (T & { mode: "verification" }) | null {
  if (ctx.backupType !== "database") return null;
  if (ctx.mode === "verification") return ctx as T & { mode: "verification" };
  if (ctx.mode === undefined && isLegacyTestRestoreTarget(ctx.targetPath)) {
    return { ...ctx, mode: "verification" };
  }
  return null;
}

function isLegacyTestRestoreTarget(targetPath: string | undefined): boolean {
  return typeof targetPath === "string" && targetPath.startsWith("/tmp/daoflow-restore/");
}

export async function cleanupRestoreDownload(
  ctx: Pick<RestoreResolved, "downloadPath" | "targetPath">
): Promise<void> {
  if (ctx.downloadPath !== ctx.targetPath) {
    await removeSensitiveStaging(ctx.downloadPath);
  }
}

async function readDatabasePassword(volumeId: string): Promise<string | undefined> {
  const [volume] = await db.select().from(volumes).where(eq(volumes.id, volumeId)).limit(1);
  if (!volume) {
    throw new Error("Backup volume is no longer available.");
  }

  return readRestoreMetadataString(volume.metadata, "databasePassword");
}

export const restoreActivityTestHooks = { resolvePostgresRestoreVerificationContext };
