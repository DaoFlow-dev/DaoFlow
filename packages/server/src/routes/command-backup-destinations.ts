import { TRPCError } from "@trpc/server";
import {
  createDestination,
  deleteDestination,
  getDestinationConfig,
  testDestinationConnection,
  updateDestination
} from "../db/services/destinations";
import { backupRunProcedure, getActorContext, t } from "../trpc";
import { listRemoteJson } from "../worker/rclone-executor";
import { requireActorTeamId } from "./team-scope";
import {
  backupDestinationCreateInputSchema,
  backupDestinationIdInputSchema,
  backupDestinationUpdateInputSchema,
  destinationFileListInputSchema
} from "./command-backup-schemas";

export const backupDestinationCommandRouter = t.router({
  createBackupDestination: backupRunProcedure
    .input(backupDestinationCreateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const actor = getActorContext(ctx);
      const teamId = await requireActorTeamId(actor.requestedByUserId);
      return createDestination(
        input,
        teamId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );
    }),
  updateBackupDestination: backupRunProcedure
    .input(backupDestinationUpdateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const actor = getActorContext(ctx);
      const teamId = await requireActorTeamId(actor.requestedByUserId);
      const result = await updateDestination(
        input,
        teamId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Destination not found." });
      }
      return result;
    }),
  deleteBackupDestination: backupRunProcedure
    .input(backupDestinationIdInputSchema)
    .mutation(async ({ input, ctx }) => {
      const actor = getActorContext(ctx);
      const teamId = await requireActorTeamId(actor.requestedByUserId);
      const result = await deleteDestination(
        input.id,
        teamId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );
      if (!result.deleted) {
        if (result.error === "Destination not found.") {
          throw new TRPCError({ code: "NOT_FOUND", message: result.error });
        }
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "Delete failed." });
      }
      return { ok: true };
    }),
  testBackupDestination: backupRunProcedure
    .input(backupDestinationIdInputSchema)
    .mutation(async ({ input, ctx }) => {
      const actor = getActorContext(ctx);
      const teamId = await requireActorTeamId(actor.requestedByUserId);
      const result = await testDestinationConnection(input.id, teamId);
      if (result.error === "Destination not found.") {
        throw new TRPCError({ code: "NOT_FOUND", message: result.error });
      }
      return result;
    }),
  listDestinationFiles: backupRunProcedure
    .input(destinationFileListInputSchema)
    .query(async ({ input, ctx }) => {
      const actor = getActorContext(ctx);
      const teamId = await requireActorTeamId(actor.requestedByUserId);
      const config = await getDestinationConfig(input.id, teamId);
      if (!config) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Destination not found." });
      }

      return listRemoteJson(config, input.path);
    })
});
