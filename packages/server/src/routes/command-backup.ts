import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  queueBackupRestore,
  triggerBackupRun,
  enableBackupSchedule,
  disableBackupSchedule
} from "../db/services/backups";
import {
  createDestination,
  updateDestination,
  deleteDestination,
  testDestinationConnection
} from "../db/services/destinations";
import { listRemoteJson } from "../worker/rclone-executor";
import type { BackupProvider } from "../db/schema/destinations";
import { db } from "../db/connection";
import { backupDestinations } from "../db/schema/destinations";
import { eq } from "drizzle-orm";
import { t, backupRunProcedure, backupRestoreProcedure, getActorContext } from "../trpc";

export const backupRouter = t.router({
  triggerBackupRun: backupRunProcedure
    .input(
      z.object({
        policyId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const run = await triggerBackupRun(
        input.policyId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup policy not found."
        });
      }

      return run;
    }),
  queueBackupRestore: backupRestoreProcedure
    .input(
      z.object({
        backupRunId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const restore = await queueBackupRestore(
        input.backupRunId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      if (!restore) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only successful backup runs with an artifact can be restored."
        });
      }

      return restore;
    }),

  /** Task #21: Test-restore to verify backup integrity */
  triggerTestRestore: backupRestoreProcedure
    .input(
      z.object({
        backupRunId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const restore = await queueBackupRestore(
        input.backupRunId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole,
        { testRestore: true }
      );

      if (!restore) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only successful backup runs with an artifact can be test-restored."
        });
      }

      return restore;
    }),

  /* ── Backup Destinations ──────────────────────────────── */
  createBackupDestination: backupRunProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        provider: z.enum(["s3", "local", "gdrive", "onedrive", "dropbox", "sftp", "rclone"]),
        accessKey: z.string().optional(),
        secretAccessKey: z.string().optional(),
        bucket: z.string().optional(),
        region: z.string().optional(),
        endpoint: z.string().optional(),
        s3Provider: z.string().optional(),
        rcloneType: z.string().optional(),
        rcloneConfig: z.string().optional(),
        rcloneRemotePath: z.string().optional(),
        oauthToken: z.string().optional(),
        localPath: z.string().optional()
      })
    )
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
    .input(
      z.object({
        id: z.string().min(1),
        name: z.string().min(1).max(100).optional(),
        provider: z
          .enum(["s3", "local", "gdrive", "onedrive", "dropbox", "sftp", "rclone"])
          .optional(),
        accessKey: z.string().optional(),
        secretAccessKey: z.string().optional(),
        bucket: z.string().optional(),
        region: z.string().optional(),
        endpoint: z.string().optional(),
        s3Provider: z.string().optional(),
        rcloneType: z.string().optional(),
        rcloneConfig: z.string().optional(),
        rcloneRemotePath: z.string().optional(),
        oauthToken: z.string().optional(),
        localPath: z.string().optional()
      })
    )
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
    .input(z.object({ id: z.string().min(1) }))
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
    .input(z.object({ id: z.string().min(1) }))
    .mutation(async ({ input }) => {
      return testDestinationConnection(input.id);
    }),
  listDestinationFiles: backupRunProcedure
    .input(z.object({ id: z.string().min(1), path: z.string().optional() }))
    .query(async ({ input }) => {
      const [row] = await db
        .select()
        .from(backupDestinations)
        .where(eq(backupDestinations.id, input.id))
        .limit(1);
      if (!row) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Destination not found." });
      }
      return listRemoteJson(
        {
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
        },
        input.path
      );
    }),

  /* ── Backup Schedule Management ────────────────────────── */
  enableBackupSchedule: backupRunProcedure
    .input(
      z.object({
        policyId: z.string().min(1),
        schedule: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await enableBackupSchedule(
        input.policyId,
        input.schedule,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );
      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup policy not found."
        });
      }
      return result;
    }),
  disableBackupSchedule: backupRunProcedure
    .input(
      z.object({
        policyId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await disableBackupSchedule(
        input.policyId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );
      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup policy not found or no active schedule."
        });
      }
      return result;
    }),
  triggerBackupNow: backupRunProcedure
    .input(
      z.object({
        policyId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const run = await triggerBackupRun(
        input.policyId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );
      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup policy not found."
        });
      }
      return run;
    })
});
