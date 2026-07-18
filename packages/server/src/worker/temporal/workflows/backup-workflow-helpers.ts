import type { BackupPolicyResolved, BackupRunResult } from "../activities/backup-activity-types";
import {
  appendBackupRunLog,
  applyGFSRetention,
  buildBackupNotification,
  checkStorageQuota,
  cleanupDumpFile,
  dispatchNotification,
  emitBackupEvent,
  executeBackupCopy,
  executeDatabaseDump,
  verifyBackupIntegrity
} from "./backup-workflow-activities";

export type BackupRunLogger = (
  input: Parameters<typeof appendBackupRunLog>[0] & {
    runId: string;
  }
) => Promise<void>;

export function createBackupRunLogger(): BackupRunLogger {
  return async (input) => {
    try {
      await appendBackupRunLog(input);
    } catch {
      // Run-log persistence is best-effort and must not change backup outcome.
    }
  };
}

export async function dispatchBackupStarted(resolved: BackupPolicyResolved): Promise<void> {
  try {
    const notification = await buildBackupNotification({
      eventType: "backup.started",
      policyName: resolved.policyName,
      projectName: resolved.projectName,
      environmentName: resolved.environmentName,
      serviceName: resolved.serviceName,
      status: "started"
    });
    await dispatchNotification(notification);
  } catch {
    // Notifications are best-effort, don't fail the backup.
  }
}

export async function executeBackupPayload(
  resolved: BackupPolicyResolved,
  runId: string,
  writeRunLog: BackupRunLogger
): Promise<BackupRunResult> {
  if (resolved.backupType === "database" && resolved.databaseEngine) {
    await writeRunLog({
      runId,
      level: "info",
      phase: "backup",
      message: `Starting ${resolved.databaseEngine} dump for ${
        resolved.databaseName ?? resolved.volumeName
      }.`
    });
    const dumpResult = await executeDatabaseDump({
      volumeId: resolved.volumeId,
      containerName: resolved.containerName ?? resolved.volumeName,
      engine: resolved.databaseEngine as "postgres" | "mysql" | "mariadb" | "mongo",
      databaseName: resolved.databaseName,
      user: resolved.databaseUser
    });

    if (!dumpResult.success) {
      throw new Error(`Database dump failed: ${dumpResult.error}`);
    }

    await writeRunLog({
      runId,
      level: "info",
      phase: "backup",
      message: "Database dump completed. Uploading artifact to the configured destination."
    });

    try {
      const copyResult = await executeBackupCopy(resolved, runId, dumpResult.dumpPath);
      return {
        ...copyResult,
        checksum: dumpResult.checksum,
        artifactFormat: dumpResult.artifactFormat,
        databaseEngineVersion: dumpResult.databaseEngineVersion,
        databaseImageReference: dumpResult.databaseImageReference
      };
    } finally {
      await cleanupDumpFile(dumpResult.dumpPath);
    }
  }

  await writeRunLog({
    runId,
    level: "info",
    phase: "backup",
    message: `Starting volume copy from ${resolved.mountPath} to the configured backup destination.`
  });
  return executeBackupCopy(resolved, runId);
}

export async function verifyBackupResult(
  policyId: string,
  resolved: BackupPolicyResolved,
  result: BackupRunResult,
  writeRunLog: BackupRunLogger
): Promise<void> {
  try {
    await writeRunLog({
      runId: result.runId,
      level: "info",
      phase: "verify",
      message: `Verifying integrity for ${result.artifactPath}.`
    });
    const integrity = await verifyBackupIntegrity(resolved, result.artifactPath, result.runId);
    if (!integrity.verified) {
      await writeRunLog({
        runId: result.runId,
        level: "warn",
        phase: "verify",
        message: `Integrity verification failed for ${result.artifactPath}: ${
          integrity.error ?? "unknown error"
        }.`
      });
      await emitBackupEvent(
        policyId,
        "backup.integrity.warning",
        "Backup integrity check failed",
        `Integrity check failed for ${result.artifactPath}: ${integrity.error ?? "unknown"}`,
        "error"
      );
    } else {
      await writeRunLog({
        runId: result.runId,
        level: "info",
        phase: "verify",
        message: `Integrity verification passed for ${result.artifactPath}.`
      });
    }
  } catch {
    await writeRunLog({
      runId: result.runId,
      level: "warn",
      phase: "verify",
      message: `Integrity verification could not complete for ${result.artifactPath}.`
    });
  }
}

export async function applyRetentionAndQuota(
  policyId: string,
  resolved: BackupPolicyResolved,
  runId: string,
  writeRunLog: BackupRunLogger
): Promise<void> {
  try {
    const retentionResult = await applyGFSRetention({
      policyId,
      retentionDaily: resolved.retentionDaily ?? 7,
      retentionWeekly: resolved.retentionWeekly ?? 4,
      retentionMonthly: resolved.retentionMonthly ?? 12,
      maxBackups: resolved.maxBackups ?? 100,
      destinationId: resolved.destinationId,
      volumeId: resolved.volumeId
    });

    if (retentionResult.deletedRuns > 0) {
      await writeRunLog({
        runId,
        level: "info",
        phase: "retention",
        message: `Applied retention policy and pruned ${retentionResult.deletedRuns} older backup run(s).`
      });
      await emitBackupEvent(
        policyId,
        "backup.retention.applied",
        "Retention policy applied",
        `Pruned ${retentionResult.deletedRuns} old backup(s). Kept ${retentionResult.keptRuns} of ${retentionResult.totalRuns}.`
      );
    }
  } catch {
    // Retention failure shouldn't fail the backup.
  }

  try {
    if (resolved.destinationId) {
      await checkStorageQuota({
        destinationId: resolved.destinationId,
        teamId: resolved.teamId
      });
    }
  } catch {
    // Quota check is best-effort.
  }
}

export async function dispatchBackupSucceeded(
  resolved: BackupPolicyResolved,
  result: BackupRunResult
): Promise<void> {
  try {
    const notification = await buildBackupNotification({
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
    // Notifications are best-effort.
  }
}

export async function dispatchBackupFailed(
  policyId: string,
  resolved: BackupPolicyResolved,
  message: string
): Promise<void> {
  try {
    const notification = await buildBackupNotification({
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
    // Notifications are best-effort.
  }
}
