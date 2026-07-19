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

import { patched, proxyActivities } from "@temporalio/workflow";
import type * as restoreActs from "../activities/restore-activities";
import type * as notificationActs from "../activities/notification-activities";
import type { RestoreWorkflowInput } from "../restore-workflow-input";

const {
  resolveRestoreContext,
  downloadBackupArtifact,
  executeRestore,
  cleanupRestoreDownload,
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

export type { RestoreWorkflowInput } from "../restore-workflow-input";

// ── Workflow ─────────────────────────────────────────────────

export async function restoreWorkflow(input: RestoreWorkflowInput): Promise<void> {
  const { backupRunId, triggeredBy, approval } = input;
  const usesExplicitRestoreMode = patched("restore-workflow-explicit-mode-v1");
  const mode = input.mode ?? (input.testRestore ? "verification" : "restore");

  // Phase 1: Resolve context
  const ctx = usesExplicitRestoreMode
    ? await resolveRestoreContext({
        backupRunId,
        restoreId: input.restoreId,
        targetPath: input.targetPath,
        triggeredBy,
        mode,
        approval
      })
    : await resolveRestoreContext({
        backupRunId,
        restoreId: input.restoreId,
        targetPath: input.targetPath,
        triggeredBy,
        testRestore: input.testRestore,
        approval
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

  let verificationResult: Awaited<ReturnType<typeof executeRestore>>["verificationResult"];

  try {
    // Emit started event
    if (usesExplicitRestoreMode) {
      await emitRestoreEvent(
        ctx.restoreId,
        "restore.started",
        mode === "verification" ? "Backup verification started" : "Restore started",
        mode === "verification"
          ? `Verifying backup ${backupRunId} in an isolated target`
          : `Restoring backup ${backupRunId} to ${ctx.targetPath}`
      );

      await auditRestoreAction(
        ctx.restoreId,
        mode === "verification" ? "backup.verify.execute" : "restore.execute",
        mode === "verification"
          ? `Starting isolated verification for backup run ${backupRunId}`
          : `Starting restore from backup run ${backupRunId}`
      );
    } else {
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
    }

    // Dispatch "started" notification
    try {
      const notification = await buildBackupNotification({
        eventType: "restore.started",
        teamId: ctx.teamId,
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

    const restore = await executeRestore(ctx, download);
    if (usesExplicitRestoreMode) {
      verificationResult = restore.verificationResult;
    }

    if (!restore.success) {
      throw new Error(`Restore execution failed: ${restore.error}`);
    }

    // Phase 3: Mark success
    if (usesExplicitRestoreMode) {
      await markRestoreSucceeded(ctx.restoreId, verificationResult);
    } else {
      await markRestoreSucceeded(ctx.restoreId);
    }

    // Phase 4: If test restore, mark backup as verified (#21 + #22)
    if (
      (usesExplicitRestoreMode && mode === "verification") ||
      (!usesExplicitRestoreMode && input.testRestore)
    ) {
      await markBackupVerified(ctx.runId);
      await emitRestoreEvent(
        ctx.restoreId,
        "restore.test.passed",
        "Test restore passed",
        `Backup ${backupRunId} verified via test restore`
      );
    }

    // Phase 5: Emit success event
    if (usesExplicitRestoreMode) {
      await emitRestoreEvent(
        ctx.restoreId,
        mode === "verification" ? "restore.verification.succeeded" : "restore.succeeded",
        mode === "verification" ? "Backup verification completed" : "Restore completed",
        mode === "verification"
          ? `Backup ${backupRunId} restored successfully in an isolated database`
          : `Successfully restored backup ${backupRunId} to ${ctx.targetPath}`
      );

      await auditRestoreAction(
        ctx.restoreId,
        mode === "verification" ? "backup.verify.succeeded" : "restore.succeeded",
        mode === "verification" && verificationResult
          ? `Verified backup ${backupRunId} with checksum ${verificationResult.checksum} using PostgreSQL ${verificationResult.verifierEngineVersion}.`
          : `Completed restore from backup run ${backupRunId}.`
      );
    } else {
      await emitRestoreEvent(
        ctx.restoreId,
        "restore.succeeded",
        "Restore completed",
        `Successfully restored backup ${backupRunId} to ${ctx.targetPath}`
      );
    }

    // Phase 6: Dispatch "succeeded" notification
    try {
      const notification = await buildBackupNotification({
        eventType: "restore.succeeded",
        teamId: ctx.teamId,
        policyName: `restore-${backupRunId}`,
        status: "succeeded"
      });
      await dispatchNotification(notification);
    } catch {
      // Best-effort
    }
  } catch (err) {
    const errorMsg = err instanceof Error ? err.message : "Unknown restore error";

    if (usesExplicitRestoreMode) {
      await markRestoreFailed(ctx.restoreId, errorMsg, verificationResult);
    } else {
      await markRestoreFailed(ctx.restoreId, errorMsg);
    }

    await emitRestoreEvent(ctx.restoreId, "restore.failed", "Restore failed", errorMsg, "error");

    if (usesExplicitRestoreMode) {
      await auditRestoreAction(
        ctx.restoreId,
        mode === "verification" ? "backup.verify.failed" : "restore.failed",
        errorMsg,
        "failure"
      );
    } else {
      await auditRestoreAction(ctx.restoreId, "restore.failed", errorMsg, "failure");
    }

    // Dispatch "failed" notification
    try {
      const notification = await buildBackupNotification({
        eventType: "restore.failed",
        teamId: ctx.teamId,
        policyName: `restore-${backupRunId}`,
        status: "failed",
        error: errorMsg
      });
      await dispatchNotification(notification);
    } catch {
      // Best-effort
    }

    throw err;
  } finally {
    try {
      await cleanupRestoreDownload(ctx);
    } catch {
      // Best-effort cleanup must not replace the restore result.
    }
  }
}
