import { proxyActivities } from "@temporalio/workflow";
import type * as backupActs from "../activities/backup-activities";
import type * as backupLogActs from "../activities/backup-log-activities";
import type * as dbActs from "../activities/database-activities";
import type * as notificationActs from "../activities/notification-activities";
import type * as retentionActs from "../activities/retention-activities";

export const {
  resolveBackupPolicy,
  createBackupRun,
  executeBackupCopy,
  markBackupRunSucceeded,
  markBackupRunFailed,
  emitBackupEvent,
  auditBackupAction,
  checkBackupLock,
  verifyBackupIntegrity,
  checkStorageQuota
} = proxyActivities<typeof backupActs>({
  startToCloseTimeout: "30 minutes",
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    initialInterval: "30s",
    maximumInterval: "5m"
  }
});

export const { appendBackupRunLog } = proxyActivities<typeof backupLogActs>({
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 2,
    initialInterval: "5s",
    maximumInterval: "15s"
  }
});

export const { executeDatabaseDump, stopContainer, startContainer, cleanupDumpFile } =
  proxyActivities<typeof dbActs>({
    startToCloseTimeout: "30 minutes",
    retry: {
      maximumAttempts: 2,
      backoffCoefficient: 2,
      initialInterval: "10s",
      maximumInterval: "2m"
    }
  });

export const { applyRetentionPolicy: applyGFSRetention } = proxyActivities<typeof retentionActs>({
  startToCloseTimeout: "10 minutes",
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 2,
    initialInterval: "10s",
    maximumInterval: "2m"
  }
});

export const { dispatchNotification, buildBackupNotification } = proxyActivities<
  typeof notificationActs
>({
  startToCloseTimeout: "30 seconds",
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 1,
    initialInterval: "5s",
    maximumInterval: "10s"
  }
});
