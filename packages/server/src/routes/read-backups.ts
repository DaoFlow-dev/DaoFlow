import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  listBackupOverviewForTeam,
  listBackupRestoreQueueForTeam,
  listPersistentVolumeInventoryForTeam
} from "../db/services/backup-team-lists";
import { getBackupRunDetails } from "../db/services/backup-run-details";
import { resolveTeamIdForUser } from "../db/services/teams";
import { backupReadProcedure, t, volumesReadProcedure } from "../trpc";
import { limitInput } from "../schemas";
import { assertBackupRunScope } from "./backup-scope";

async function requireTeamId(userId: string) {
  const teamId = await resolveTeamIdForUser(userId);
  if (!teamId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No organization is available for this user."
    });
  }
  return teamId;
}

export const backupReadRouter = t.router({
  backupOverview: backupReadProcedure.input(limitInput(50)).query(async ({ ctx, input }) => {
    const teamId = await requireTeamId(ctx.session.user.id);
    return listBackupOverviewForTeam(teamId, input.limit ?? 12);
  }),
  backupRestoreQueue: backupReadProcedure.input(limitInput(50)).query(async ({ ctx, input }) => {
    const teamId = await requireTeamId(ctx.session.user.id);
    return listBackupRestoreQueueForTeam(teamId, input.limit ?? 12);
  }),
  persistentVolumes: volumesReadProcedure.input(limitInput(24)).query(async ({ ctx, input }) => {
    const teamId = await requireTeamId(ctx.session.user.id);
    return listPersistentVolumeInventoryForTeam(teamId, input.limit ?? 12);
  }),
  backupRunDetails: backupReadProcedure
    .input(
      z.object({
        runId: z.string().min(1)
      })
    )
    .query(async ({ ctx, input }) => {
      await assertBackupRunScope({
        ctx,
        backupRunId: input.runId,
        action: "backup.details.denied",
        permissionScope: "backup:read"
      });
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
