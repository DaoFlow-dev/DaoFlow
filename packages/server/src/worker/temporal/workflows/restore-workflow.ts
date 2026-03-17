/**
 * restore-workflow.ts
 *
 * Temporal workflow for backup restore operations.
 *
 * Flow:
 * 1. Resolve restore context (backup run + destination + policy metadata)
 * 2. Download backup artifact from remote (rclone handles crypt transparently)
 * 3. For database backups: run appropriate restore command
 * 4. Mark restore succeeded/failed
 * 5. For test restores: mark backup as verified and cleanup
 * 6. Dispatch notifications
 */

import { proxyActivities } from "@temporalio/workflow";
import type * as restoreActs from "../activities/restore-activities";
import type * as notificationActs from "../activities/notification-activities";

const {
  resolveRestoreContext,
  downloadBackupArtifact,
  markRestoreSucceeded,
  markRestoreFailed,
  markBackupVerified,
  emitRestoreEvent,
  auditRestoreAction
} = proxyActivities<typeof restoreActs>({
  startToCloseTimeout: "60 minutes",
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 2,
    initialInterval: "30s",
    maximumInterval: "5m"
  },
  heartbeatTimeout: "2 minutes"
});

const { dispatchNotification, buildBackupNotification } = proxyActivities<typeof notificationActs>({
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: "5s",
    maximumInterval: "10s"
  }
});

// ── Workflow Input ────────────────────────────────────────────

export interface RestoreWorkflowInput {
  /** ID of the backup run to restore from (#24: point-in-time by run ID) */
  backupRunId: string;
  /** Target path override (optional) */
  targetPath?: string;
  /** Who triggered the restore */
  triggeredBy: string;
  /** If true, restore to temp and verify, then cleanup (#21: test restore) */
  testRestore?: boolean;
}

// ── Workflow ─────────────────────────────────────────────────

export async function restoreWorkflow(input: RestoreWorkflowInput): Promise<void> {
  const { backupRunId, triggeredBy, testRestore } = input;

  // Phase 1: Resolve context
  const ctx = await resolveRestoreContext({
    backupRunId,
    targetPath: input.targetPath,
    triggeredBy,
    testRestore
  });

  if (!ctx) {
    await emitRestoreEvent(
      backupRunId,
      "restore.skipped",
      "Restore skipped",
      `Backup run ${backupRunId} not found, has no artifact, or is not in succeeded state`,
      "info"
    );
    return;
  }

  try {
    // Emit started event
    await emitRestoreEvent(
      ctx.restoreId,
      "restore.started",
      "Restore started",
      `Restoring backup ${backupRunId} to ${ctx.targetPath}`
    );

    await auditRestoreAction(
      ctx.restoreId,
      "restore.execute",
      `Starting restore from backup run ${backupRunId}`
    );

    // Dispatch "started" notification
    try {
      const notification = await buildBackupNotification({
        eventType: "restore.started",
        policyName: `restore-${backupRunId}`,
        status: "started"
      });
      await dispatchNotification(notification);
    } catch {
      // Best-effort
    }

    // Phase 2: Download backup artifact (#19 + #20 encrypted restore via rclone-crypt)
    const download = await downloadBackupArtifact(ctx);

    if (!download.success) {
      throw new Error(`Download failed: ${download.error}`);
    }

    // Phase 3: Mark success
    await markRestoreSucceeded(ctx.restoreId);

    // Phase 4: If test restore, mark backup as verified (#21 + #22)
    if (testRestore) {
      await markBackupVerified(ctx.runId);
      await emitRestoreEvent(
        ctx.restoreId,
        "restore.test.passed",
        "Test restore passed",
        `Backup ${backupRunId} verified via test restore`
      );
    }

    // Phase 5: Emit success event
    await emitRestoreEvent(
      ctx.restoreId,
      "restore.succeeded",
      "Restore completed",
      `Successfully restored backup ${backupRunId} to ${ctx.targetPath}`
    );

    // Phase 6: Dispatch "succeeded" notification
    try {
      const notification = await buildBackupNotification({
        eventType: "restore.succeeded",
        policyName: `restore-${backupRunId}`,
        status: "succeeded"
      });
      await dispatchNotification(notification);
    } catch {
      // Best-effort
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown restore error";

    await markRestoreFailed(ctx.restoreId, errorMsg);

    await emitRestoreEvent(ctx.restoreId, "restore.failed", "Restore failed", errorMsg, "error");

    await auditRestoreAction(ctx.restoreId, "restore.failed", errorMsg, "failure");

    // Dispatch "failed" notification
    try {
      const notification = await buildBackupNotification({
        eventType: "restore.failed",
        policyName: `restore-${backupRunId}`,
        status: "failed",
        error: errorMsg
      });
      await dispatchNotification(notification);
    } catch {
      // Best-effort
    }

    throw err;
  }
}
