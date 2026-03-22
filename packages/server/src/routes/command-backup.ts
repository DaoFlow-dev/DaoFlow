import { t } from "../trpc";
import { backupDestinationCommandRouter } from "./command-backup-destinations";
import { backupExecutionCommandRouter } from "./command-backup-execution";
import { backupStorageCommandRouter } from "./command-backup-storage";

export const backupRouter = t.mergeRouters(
  backupExecutionCommandRouter,
  backupDestinationCommandRouter,
  backupStorageCommandRouter
);
