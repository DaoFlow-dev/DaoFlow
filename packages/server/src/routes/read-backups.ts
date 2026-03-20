import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  listBackupOverview,
  listBackupRestoreQueue,
  listPersistentVolumeInventory
} from "../db/services/backups";
import { getBackupRunDetails } from "../db/services/backup-run-details";
import { backupReadProcedure, t } from "../trpc";
import { limitInput } from "../schemas";

export const backupReadRouter = t.router({
  backupOverview: backupReadProcedure.input(limitInput(50)).query(async ({ input }) => {
    return listBackupOverview(input.limit ?? 12);
  }),
  backupRestoreQueue: backupReadProcedure.input(limitInput(50)).query(async ({ input }) => {
    return listBackupRestoreQueue(input.limit ?? 12);
  }),
  persistentVolumes: backupReadProcedure.input(limitInput(24)).query(async ({ input }) => {
    return listPersistentVolumeInventory(input.limit ?? 12);
  }),
  backupRunDetails: backupReadProcedure
    .input(
      z.object({
        runId: z.string().min(1)
      })
    )
    .query(async ({ input }) => {
      const run = await getBackupRunDetails(input.runId);

      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup run not found."
        });
      }

      return run;
    })
});
