import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  queueBackupRestore,
  triggerBackupRun,
  enableBackupSchedule,
  disableBackupSchedule
} from "../db/services/backups";
import {
  createBackupPolicy,
  createVolume,
  deleteBackupPolicy,
  deleteVolume,
  updateBackupPolicy,
  updateVolume
} from "../db/services/storage-management";
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
import {
  t,
  backupRunProcedure,
  backupRestoreProcedure,
  getActorContext,
  volumesWriteProcedure
} from "../trpc";

const volumeStatusSchema = z.enum(["active", "inactive", "paused"]);
const policyStatusSchema = z.enum(["active", "paused"]);
const backupTypeSchema = z.enum(["volume", "database"]);
const databaseEngineSchema = z.enum(["postgres", "mysql", "mariadb", "mongo"]);

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

  /* ── Volume Registry ─────────────────────────────────────── */
  createVolume: volumesWriteProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        serverId: z.string().min(1).max(32),
        mountPath: z.string().min(1).max(500),
        sizeBytes: z.number().int().min(0).optional(),
        driver: z.string().min(1).max(80).optional(),
        serviceId: z.string().max(32).optional(),
        status: volumeStatusSchema.optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await createVolume(input, {
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      if (result.status === "not-found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${result.entity === "service" ? "Service" : "Server"} not found.`
        });
      }
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: result.message
        });
      }
      return result.volume;
    }),
  updateVolume: volumesWriteProcedure
    .input(
      z.object({
        volumeId: z.string().min(1).max(32),
        name: z.string().min(1).max(100).optional(),
        serverId: z.string().min(1).max(32).optional(),
        mountPath: z.string().min(1).max(500).optional(),
        sizeBytes: z.number().int().min(0).optional(),
        driver: z.string().min(1).max(80).optional(),
        serviceId: z.string().max(32).optional(),
        status: volumeStatusSchema.optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await updateVolume(input, {
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      if (result.status === "not-found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${result.entity === "volume" ? "Volume" : result.entity === "service" ? "Service" : "Server"} not found.`
        });
      }
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: result.message
        });
      }
      return result.volume;
    }),
  deleteVolume: volumesWriteProcedure
    .input(
      z.object({
        volumeId: z.string().min(1).max(32)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await deleteVolume(input.volumeId, {
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      if (result.status === "not-found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Volume not found."
        });
      }
      if (result.status === "has-dependencies") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: result.message
        });
      }
      return { deleted: true, volumeId: input.volumeId };
    }),

  /* ── Backup Policy CRUD ──────────────────────────────────── */
  createBackupPolicy: backupRunProcedure
    .input(
      z.object({
        name: z.string().min(1).max(100),
        volumeId: z.string().min(1).max(32),
        destinationId: z.string().max(32).optional(),
        backupType: backupTypeSchema.optional(),
        databaseEngine: databaseEngineSchema.nullish(),
        turnOff: z.boolean().optional(),
        schedule: z.string().max(60).optional(),
        retentionDays: z.number().int().min(1).max(3650).optional(),
        retentionDaily: z.number().int().min(0).max(3650).optional(),
        retentionWeekly: z.number().int().min(0).max(520).optional(),
        retentionMonthly: z.number().int().min(0).max(240).optional(),
        maxBackups: z.number().int().min(1).max(10_000).optional(),
        status: policyStatusSchema.optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await createBackupPolicy(input, {
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      if (result.status === "not-found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${result.entity === "destination" ? "Destination" : "Volume"} not found.`
        });
      }
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: result.message
        });
      }
      if (result.status === "precondition-failed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: result.message
        });
      }
      return result.policy;
    }),
  updateBackupPolicy: backupRunProcedure
    .input(
      z.object({
        policyId: z.string().min(1).max(32),
        name: z.string().min(1).max(100).optional(),
        volumeId: z.string().min(1).max(32).optional(),
        destinationId: z.string().max(32).optional(),
        backupType: backupTypeSchema.optional(),
        databaseEngine: databaseEngineSchema.nullish(),
        turnOff: z.boolean().optional(),
        schedule: z.string().max(60).optional(),
        retentionDays: z.number().int().min(1).max(3650).optional(),
        retentionDaily: z.number().int().min(0).max(3650).optional(),
        retentionWeekly: z.number().int().min(0).max(520).optional(),
        retentionMonthly: z.number().int().min(0).max(240).optional(),
        maxBackups: z.number().int().min(1).max(10_000).optional(),
        status: policyStatusSchema.optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await updateBackupPolicy(input, {
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      if (result.status === "not-found") {
        const label =
          result.entity === "destination"
            ? "Destination"
            : result.entity === "volume"
              ? "Volume"
              : "Backup policy";
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${label} not found.`
        });
      }
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: result.message
        });
      }
      if (result.status === "precondition-failed") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: result.message
        });
      }
      return result.policy;
    }),
  deleteBackupPolicy: backupRunProcedure
    .input(
      z.object({
        policyId: z.string().min(1).max(32)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await deleteBackupPolicy(input.policyId, {
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      if (result.status === "not-found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup policy not found."
        });
      }
      if (result.status === "has-dependencies") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: result.message
        });
      }
      return { deleted: true, policyId: input.policyId };
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
