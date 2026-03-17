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

import { proxyActivities } from "@temporalio/workflow";
import type * as backupActs from "../activities/backup-activities";
import type * as dbActs from "../activities/database-activities";
import type * as retentionActs from "../activities/retention-activities";
import type * as notificationActs from "../activities/notification-activities";

// Backup activities (existing)
const {
  resolveBackupPolicy,
  createBackupRun,
  executeBackupCopy,
  markBackupRunSucceeded,
  markBackupRunFailed,
  emitBackupEvent,
  auditBackupAction
} = proxyActivities<typeof backupActs>({
  startToCloseTimeout: "30 minutes",
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    initialInterval: "30s",
    maximumInterval: "5m"
  }
});

// Database & container lifecycle activities
const { executeDatabaseDump, stopContainer, startContainer } = proxyActivities<typeof dbActs>({
  startToCloseTimeout: "30 minutes",
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 2,
    initialInterval: "10s",
    maximumInterval: "2m"
  }
});

// Retention activities (with longer timeout for pruning many backups)
const { applyRetentionPolicy: applyGFSRetention } = proxyActivities<typeof retentionActs>({
  startToCloseTimeout: "10 minutes",
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 2,
    initialInterval: "10s",
    maximumInterval: "2m"
  }
});

// Notification activities (short timeout, best-effort)
const { dispatchNotification, buildBackupNotification } = proxyActivities<typeof notificationActs>({
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: "5s",
    maximumInterval: "10s"
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

  let runId: string | null = null;
  let containerStopped = false;

  try {
    // Phase 2: Create backup run record
    runId = await createBackupRun(policyId, triggeredBy);

    // Dispatch "started" notification
    try {
      const notification = buildBackupNotification({
        eventType: "backup.started",
        policyName: resolved.policyName,
        projectName: resolved.projectName,
        environmentName: resolved.environmentName,
        serviceName: resolved.serviceName,
        status: "started"
      });
      await dispatchNotification(notification);
    } catch {
      // Notifications are best-effort, don't fail the backup
    }

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
      const stopResult = await stopContainer(resolved.containerName ?? resolved.volumeName);
      if (stopResult.success) {
        containerStopped = true;
      } else {
        console.warn(
          `[temporal-backup] Failed to stop container ${resolved.containerName}: ${stopResult.error}`
        );
      }
    }

    // Phase 3: Execute backup based on type
    let result: { runId: string; artifactPath: string; sizeBytes: number };

    if (resolved.backupType === "database" && resolved.databaseEngine) {
      // Database-native dump
      const dumpResult = await executeDatabaseDump({
        containerName: resolved.containerName ?? resolved.volumeName,
        engine: resolved.databaseEngine as "postgres" | "mysql" | "mariadb" | "mongo",
        databaseName: resolved.databaseName,
        user: resolved.databaseUser,
        password: resolved.databasePassword
      });

      if (!dumpResult.success) {
        throw new Error(`Database dump failed: ${dumpResult.error}`);
      }

      // Upload dump via rclone
      result = await executeBackupCopy(resolved, runId);
    } else {
      // Volume tar backup (default)
      result = await executeBackupCopy(resolved, runId);
    }

    // Phase 5: Mark success
    await markBackupRunSucceeded(result.runId, result.artifactPath, result.sizeBytes);

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
    }

    // Phase 7: Apply GFS retention policy
    try {
      const retentionResult = await applyGFSRetention({
        policyId,
        retentionDaily: resolved.retentionDaily ?? 7,
        retentionWeekly: resolved.retentionWeekly ?? 4,
        retentionMonthly: resolved.retentionMonthly ?? 12,
        maxBackups: resolved.maxBackups ?? 100,
        destination: resolved.destination
      });

      if (retentionResult.deletedRuns > 0) {
        await emitBackupEvent(
          policyId,
          "backup.retention.applied",
          "Retention policy applied",
          `Pruned ${retentionResult.deletedRuns} old backup(s). Kept ${retentionResult.keptRuns} of ${retentionResult.totalRuns}.`
        );
      }
    } catch {
      // Retention failure shouldn't fail the backup
    }

    // Phase 8: Dispatch "succeeded" notification
    try {
      const notification = buildBackupNotification({
        eventType: "backup.succeeded",
        policyName: resolved.policyName,
        projectName: resolved.projectName,
        environmentName: resolved.environmentName,
        serviceName: resolved.serviceName,
        status: "succeeded",
        sizeBytes: result.sizeBytes,
        artifactPath: result.artifactPath
      });
      await dispatchNotification(notification);
    } catch {
      // Notifications are best-effort
    }
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);

    // Always restart the container if we stopped it, even on failure
    if (containerStopped) {
      try {
        await startContainer(resolved.containerName ?? resolved.volumeName);
      } catch {
        // CRITICAL: Container restart failed after backup failure
        // Visible in Temporal workflow history via activity failure
      }
    }

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

    // Dispatch "failed" notification
    try {
      const notification = buildBackupNotification({
        eventType: "backup.failed",
        policyName: resolved?.policyName ?? policyId,
        projectName: resolved?.projectName,
        environmentName: resolved?.environmentName,
        serviceName: resolved?.serviceName,
        status: "failed",
        error: message
      });
      await dispatchNotification(notification);
    } catch {
      // Notifications are best-effort
    }

    // Re-throw so Temporal records the workflow run as failed
    throw err;
  }
}
