import { TRPCError } from "@trpc/server";
import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { backupDestinations, type BackupProvider } from "../db/schema/destinations";
import {
  createDestination,
  deleteDestination,
  testDestinationConnection,
  updateDestination
} from "../db/services/destinations";
import { backupRunProcedure, getActorContext, t } from "../trpc";
import { listRemoteJson } from "../worker/rclone-executor";
import {
  backupDestinationCreateInputSchema,
  backupDestinationIdInputSchema,
  backupDestinationUpdateInputSchema,
  destinationFileListInputSchema
} from "./command-backup-schemas";

function toDestinationConfig(row: typeof backupDestinations.$inferSelect) {
  return {
    id: row.id,
    provider: row.provider as BackupProvider,
    accessKey: row.accessKey,
    secretAccessKey: row.secretAccessKey,
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    s3Provider: row.s3Provider,
    rcloneType: row.rcloneType,
    rcloneConfig: row.rcloneConfig,
    rcloneRemotePath: row.rcloneRemotePath,
    oauthToken: row.oauthToken,
    localPath: row.localPath
  };
}

export const backupDestinationCommandRouter = t.router({
  createBackupDestination: backupRunProcedure
    .input(backupDestinationCreateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const actor = getActorContext(ctx);
      return createDestination(
        input,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );
    }),
  updateBackupDestination: backupRunProcedure
    .input(backupDestinationUpdateInputSchema)
    .mutation(async ({ input, ctx }) => {
      const actor = getActorContext(ctx);
      const result = await updateDestination(
        input,
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
      const result = await deleteDestination(
        input.id,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );
      if (!result.deleted) {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.error ?? "Delete failed." });
      }
      return { ok: true };
    }),
  testBackupDestination: backupRunProcedure
    .input(backupDestinationIdInputSchema)
    .mutation(async ({ input }) => {
      return testDestinationConnection(input.id);
    }),
  listDestinationFiles: backupRunProcedure
    .input(destinationFileListInputSchema)
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(backupDestinations)
        .where(eq(backupDestinations.id, input.id))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Destination not found." });
      }

      return listRemoteJson(toDestinationConfig(row), input.path);
    })
});
