/**
 * backup-workflow.ts
 *
 * Temporal workflow for scheduled backup execution. Uses Temporal's
 * built-in cron scheduling to run backups on a policy's schedule.
 *
 * Each cron iteration:
 * 1. Resolves the policy and destination
 * 2. Optionally stops the container (turnOff mode)
 * 3. Performs database dump or volume tar based on backupType
 * 4. Creates a backup run record
 * 5. Executes rclone copy (with optional encryption)
 * 6. Computes and records SHA-256 checksum
 * 7. Updates the run status
 * 8. Restarts the container if stopped
 * 9. Applies GFS retention policy
 * 10. Dispatches notifications (Slack/Discord/webhook)
 *
 * If the worker crashes mid-workflow, Temporal replays and resumes.
 */

import {
  auditBackupAction,
  checkBackupLock,
  createBackupRun,
  emitBackupEvent,
  markBackupRunFailed,
  markBackupRunSucceeded,
  resolveBackupPolicy,
  startContainer,
  stopContainer
} from "./backup-workflow-activities";
import {
  applyRetentionAndQuota,
  createBackupRunLogger,
  dispatchBackupFailed,
  dispatchBackupStarted,
  dispatchBackupSucceeded,
  executeBackupPayload,
  verifyBackupResult
} from "./backup-workflow-helpers";

export interface BackupCronWorkflowInput {
  policyId: string;
  /** "scheduler" for cron-triggered, or a userId for manual triggers */
  triggeredBy: string;
  /** Existing manual run record to adopt when the caller needs a stable run ID before execution. */
  requestedRunId?: string;
}

/**
 * Backup cron workflow.
 *
 * Temporal calls this on the cron schedule defined when the workflow was started.
 * Each invocation is a single backup execution cycle.
 */
export async function backupCronWorkflow(input: BackupCronWorkflowInput): Promise<void> {
  const { policyId, triggeredBy, requestedRunId } = input;
  // NOTE: Do NOT use Date.now() in workflows — it breaks Temporal determinism.
  // Duration tracking is handled by activities and Temporal's own event history.

  // Phase 1: Resolve policy and validate
  const resolved = await resolveBackupPolicy(policyId);
  if (!resolved) {
    await emitBackupEvent(
      policyId,
      "backup.skipped",
      "Backup skipped",
      `Policy ${policyId} is inactive or missing required configuration`,
      "info"
    );
    return;
  }

  // Phase 1.5: Check concurrent backup lock
  const lockCheck = await checkBackupLock(policyId);
  if (lockCheck.locked) {
    await emitBackupEvent(
      policyId,
      "backup.skipped",
      "Backup skipped (locked)",
      `Another backup is already running for this policy (run: ${lockCheck.conflictingRunId})`,
      "info"
    );
    return;
  }

  let runId: string | null = null;
  let containerStopped = false;
  const writeRunLog = createBackupRunLogger();

  try {
    // Phase 2: Create backup run record
    runId = await createBackupRun(policyId, triggeredBy, requestedRunId);
    await writeRunLog({
      runId,
      level: "info",
      phase: "prepare",
      message: `Resolved policy ${resolved.policyName} for ${resolved.volumeName} on ${resolved.serverName}.`
    });

    await dispatchBackupStarted(resolved);

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

    // Phase 2.5: Stop container if turnOff is enabled
    if (resolved.turnOff) {
      await writeRunLog({
        runId,
        level: "info",
        phase: "prepare",
        message: `Stopping container ${resolved.containerName ?? resolved.volumeName} for a consistent backup window.`
      });
      const stopResult = await stopContainer(resolved.containerName ?? resolved.volumeName);
      if (stopResult.success) {
        containerStopped = true;
        await writeRunLog({
          runId,
          level: "info",
          phase: "prepare",
          message: `Stopped container ${resolved.containerName ?? resolved.volumeName}.`
        });
      } else {
        await writeRunLog({
          runId,
          level: "warn",
          phase: "prepare",
          message: `Failed to stop container ${resolved.containerName ?? resolved.volumeName}: ${stopResult.error}`
        });
        console.warn(
          `[temporal-backup] Failed to stop container ${resolved.containerName}: ${stopResult.error}`
        );
      }
    }

    const result = await executeBackupPayload(resolved, runId, writeRunLog);

    await writeRunLog({
      runId,
      level: "info",
      phase: "backup",
      message: `Uploaded artifact ${result.artifactPath} (${result.sizeBytes} bytes).`
    });

    await verifyBackupResult(policyId, resolved, result, writeRunLog);

    // Phase 5: Mark success
    await markBackupRunSucceeded(result.runId, result.artifactPath, result.sizeBytes, {
      checksum: result.checksum,
      artifactFormat: result.artifactFormat,
      databaseEngineVersion: result.databaseEngineVersion,
      databaseImageReference: result.databaseImageReference
    });
    await writeRunLog({
      runId,
      level: "info",
      phase: "complete",
      message: `Backup run completed successfully with artifact ${result.artifactPath}.`
    });

    await emitBackupEvent(
      policyId,
      "backup.succeeded",
      "Backup completed successfully",
      `Backed up ${resolved.volumeName} → ${result.artifactPath} (${result.sizeBytes} bytes)`
    );

    // Phase 6: Restart container if we stopped it
    if (containerStopped) {
      await startContainer(resolved.containerName ?? resolved.volumeName);
      containerStopped = false;
      await writeRunLog({
        runId,
        level: "info",
        phase: "cleanup",
        message: `Restarted container ${resolved.containerName ?? resolved.volumeName}.`
      });
    }

    await applyRetentionAndQuota(policyId, resolved, runId, writeRunLog);

    await dispatchBackupSucceeded(resolved, result);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Always restart the container if we stopped it, even on failure
    if (containerStopped) {
      try {
        await startContainer(resolved.containerName ?? resolved.volumeName);
        if (runId) {
          await writeRunLog({
            runId,
            level: "warn",
            phase: "cleanup",
            message: `Restarted container ${resolved.containerName ?? resolved.volumeName} during failure cleanup.`
          });
        }
      } catch {
        // CRITICAL: Container restart failed after backup failure
        // Visible in Temporal workflow history via activity failure
      }
    }

    if (runId) {
      await markBackupRunFailed(runId, message);
      await writeRunLog({
        runId,
        level: "error",
        phase: "failed",
        message
      });
    }

    await emitBackupEvent(policyId, "backup.failed", "Backup failed", message, "error");

    await auditBackupAction(
      policyId,
      "backup.failed",
      `Backup failed for ${resolved?.policyName ?? policyId}: ${message}`,
      "failure"
    );

    await dispatchBackupFailed(policyId, resolved, message);

    // Re-throw so Temporal records the workflow run as failed
    throw err;
  }
}
