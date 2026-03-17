/**
 * backup-workflow.ts
 *
 * Temporal workflow for scheduled backup execution. Uses Temporal's
 * built-in cron scheduling to run backups on a policy's schedule.
 *
 * Each cron iteration:
 * 1. Resolves the policy and destination
 * 2. Creates a backup run record
 * 3. Executes rclone copy
 * 4. Updates the run status
 * 5. Applies retention policy (purge old backups)
 *
 * If the worker crashes mid-workflow, Temporal replays and resumes.
 */

import { proxyActivities } from "@temporalio/workflow";
import type * as activities from "../activities/backup-activities";

const {
  resolveBackupPolicy,
  createBackupRun,
  executeBackupCopy,
  markBackupRunSucceeded,
  markBackupRunFailed,
  emitBackupEvent,
  applyRetentionPolicy,
  auditBackupAction
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "30 minutes",
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    initialInterval: "30s",
    maximumInterval: "5m"
  }
});

export interface BackupCronWorkflowInput {
  policyId: string;
  /** "scheduler" for cron-triggered, or a userId for manual triggers */
  triggeredBy: string;
}

/**
 * Backup cron workflow.
 *
 * Temporal calls this on the cron schedule defined when the workflow was started.
 * Each invocation is a single backup execution cycle.
 */
export async function backupCronWorkflow(input: BackupCronWorkflowInput): Promise<void> {
  const { policyId, triggeredBy } = input;

  // Phase 1: Resolve policy and validate
  const resolved = await resolveBackupPolicy(policyId);
  if (!resolved) {
    // Policy is inactive, deleted, or missing destination — skip silently
    await emitBackupEvent(
      policyId,
      "backup.skipped",
      "Backup skipped",
      `Policy ${policyId} is inactive or missing required configuration`,
      "info"
    );
    return;
  }

  let runId: string | null = null;

  try {
    // Phase 2: Create backup run record
    runId = await createBackupRun(policyId, triggeredBy);

    await emitBackupEvent(
      policyId,
      "backup.started",
      "Backup started",
      `Starting backup for ${resolved.volumeName} on ${resolved.serverName}`
    );

    await auditBackupAction(
      policyId,
      "backup.execute",
      `Temporal worker started backup for ${resolved.policyName} (run: ${runId})`
    );

    // Phase 3: Execute the backup copy
    const result = await executeBackupCopy(resolved, runId);

    // Phase 4: Mark success
    await markBackupRunSucceeded(result.runId, result.artifactPath, result.sizeBytes);

    await emitBackupEvent(
      policyId,
      "backup.succeeded",
      "Backup completed successfully",
      `Backed up ${resolved.volumeName} → ${result.artifactPath} (${result.sizeBytes} bytes)`
    );

    console.log(
      `[temporal-backup] Backup ${runId} completed: ${result.artifactPath} (${result.sizeBytes} bytes)`
    );

    // Phase 5: Apply retention policy
    const purged = await applyRetentionPolicy(resolved);
    if (purged > 0) {
      await emitBackupEvent(
        policyId,
        "backup.retention.applied",
        "Retention policy applied",
        `Purged ${purged} old backup(s) beyond ${resolved.retentionDays}-day retention`
      );
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[temporal-backup] Backup failed for policy ${policyId}:`, message);

    if (runId) {
      await markBackupRunFailed(runId, message);
    }

    await emitBackupEvent(policyId, "backup.failed", "Backup failed", message, "error");

    await auditBackupAction(
      policyId,
      "backup.failed",
      `Backup failed for ${resolved?.policyName ?? policyId}: ${message}`,
      "failure"
    );

    // Re-throw so Temporal records the workflow run as failed
    throw err;
  }
}
