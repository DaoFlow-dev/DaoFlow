import { t } from "../trpc";
import { backupDestinationCommandRouter } from "./command-backup-destinations";
import { backupExecutionCommandRouter } from "./command-backup-execution";
import { backupStorageCommandRouter } from "./command-backup-storage";
import { externalBackupArtifactCommandRouter } from "./external-backup-artifacts";

export const backupRouter = t.mergeRouters(
  backupExecutionCommandRouter,
  backupDestinationCommandRouter,
  backupStorageCommandRouter,
  externalBackupArtifactCommandRouter
);
