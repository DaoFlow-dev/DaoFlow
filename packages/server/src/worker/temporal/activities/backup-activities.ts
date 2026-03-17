/**
 * backup-activities.ts
 *
 * Temporal activities for backup execution. Each activity is a
 * side-effectful function that wraps DB operations and rclone commands.
 *
 * Activities are NOT deterministic — they perform I/O. The backup
 * workflow orchestrates them in the correct order.
 */

import { eq, and, lt } from "drizzle-orm";
import { db } from "../../../db/connection";
import { backupPolicies, backupRuns, volumes } from "../../../db/schema/storage";
import { backupDestinations } from "../../../db/schema/destinations";
import { auditEntries, events } from "../../../db/schema/audit";
import { servers } from "../../../db/schema/servers";
import {
  copyToRemote,
  listRemote,
  deleteRemote,
  type DestinationConfig
} from "../../rclone-executor";
import type { BackupProvider } from "../../../db/schema/destinations";
import { newId } from "../../../db/services/json-helpers";

// ── Types ────────────────────────────────────────────────────

export interface BackupPolicyResolved {
  policyId: string;
  policyName: string;
  volumeId: string;
  volumeName: string;
  mountPath: string;
  serverId: string;
  serverName: string;
  retentionDays: number;
  destination: DestinationConfig;
}

export interface BackupRunResult {
  runId: string;
  artifactPath: string;
  sizeBytes: number;
}

// ── Exported Activities ──────────────────────────────────────

/**
 * Load and validate a backup policy with all related entities.
 * Returns null if the policy is inactive or missing required data.
 */
export async function resolveBackupPolicy(policyId: string): Promise<BackupPolicyResolved | null> {
  const [policy] = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, policyId))
    .limit(1);

  if (!policy || policy.status !== "active") return null;

  const [volume] = await db.select().from(volumes).where(eq(volumes.id, policy.volumeId)).limit(1);

  if (!volume) return null;

  const [server] = await db.select().from(servers).where(eq(servers.id, volume.serverId)).limit(1);

  if (!server) return null;

  // Resolve destination — either from FK or legacy storageTarget
  if (!policy.destinationId) return null;

  const [dest] = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, policy.destinationId))
    .limit(1);

  if (!dest) return null;

  return {
    policyId: policy.id,
    policyName: policy.name,
    volumeId: volume.id,
    volumeName: volume.name,
    mountPath: volume.mountPath,
    serverId: server.id,
    serverName: server.name,
    retentionDays: policy.retentionDays,
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
    }
  };
}

/**
 * Create a new backup run record in the database.
 */
export async function createBackupRun(policyId: string, triggeredBy: string): Promise<string> {
  const runId = newId();
  const now = new Date();

  await db.insert(backupRuns).values({
    id: runId,
    policyId,
    status: "running",
    triggeredByUserId: triggeredBy === "scheduler" ? null : triggeredBy,
    startedAt: now,
    createdAt: now
  });

  return runId;
}

/**
 * Execute the actual backup copy using rclone.
 * Copies from the volume mount path to the remote destination.
 */
export async function executeBackupCopy(
  resolved: BackupPolicyResolved,
  runId: string
): Promise<BackupRunResult> {
  const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
  const remotePath = `${resolved.policyName}/${timestamp}`;

  // Use rclone to copy the volume data to the destination
  const copyResult = copyToRemote(resolved.destination, resolved.mountPath, remotePath);
  if (!copyResult.success) {
    throw new Error(`rclone copy failed: ${copyResult.error ?? copyResult.output}`);
  }

  // List the destination to get size info
  let sizeBytes = 0;
  try {
    const listing = listRemote(resolved.destination, remotePath);
    // Parse listing output to estimate size (each line has size info)
    for (const line of listing.output.split("\n")) {
      const match = /^\s*(\d+)\s/.exec(line.trim());
      if (match) {
        sizeBytes += parseInt(match[1], 10);
      }
    }
  } catch {
    // Size estimation is best-effort
    console.warn(`[backup] Could not estimate backup size for run ${runId}`);
  }

  return {
    runId,
    artifactPath: remotePath,
    sizeBytes
  };
}

/**
 * Mark a backup run as succeeded.
 */
export async function markBackupRunSucceeded(
  runId: string,
  artifactPath: string,
  sizeBytes: number
): Promise<void> {
  await db
    .update(backupRuns)
    .set({
      status: "succeeded",
      artifactPath,
      sizeBytes: String(sizeBytes),
      completedAt: new Date()
    })
    .where(eq(backupRuns.id, runId));
}

/**
 * Mark a backup run as failed.
 */
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

/**
 * Emit a backup event to the operations timeline.
 */
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

/**
 * Apply retention policy by removing old backup runs and their remote artifacts.
 */
export async function applyRetentionPolicy(resolved: BackupPolicyResolved): Promise<number> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - resolved.retentionDays);

  // Find old successful runs that are past retention
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

    // Mark the run as expired
    await db.update(backupRuns).set({ status: "expired" }).where(eq(backupRuns.id, run.id));
  }

  return purged;
}

/**
 * Record an audit entry for a backup operation.
 */
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
