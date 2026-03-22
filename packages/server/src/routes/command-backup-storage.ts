import { TRPCError } from "@trpc/server";
import { disableBackupSchedule, enableBackupSchedule } from "../db/services/backups";
import {
  createBackupPolicy,
  createVolume,
  deleteBackupPolicy,
  deleteVolume,
  updateBackupPolicy,
  updateVolume
} from "../db/services/storage-management";
import { backupRunProcedure, getActorContext, t, volumesWriteProcedure } from "../trpc";
import {
  backupPolicyCreateInputSchema,
  backupPolicyIdInputSchema,
  backupPolicyUpdateInputSchema,
  backupScheduleEnableInputSchema,
  volumeCreateInputSchema,
  volumeDeleteInputSchema,
  volumeUpdateInputSchema
} from "./command-backup-schemas";

function throwVolumeMutationError(result: { status: string; entity?: string; message?: string }) {
  if (result.status === "not-found") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${
        result.entity === "volume" ? "Volume" : result.entity === "service" ? "Service" : "Server"
      } not found.`
    });
  }

  if (result.status === "conflict") {
    throw new TRPCError({
      code: "CONFLICT",
      message: result.message ?? "Conflict."
    });
  }

  if (result.status === "has-dependencies") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: result.message ?? "The volume has dependent resources."
    });
  }
}

function throwBackupPolicyMutationError(result: {
  status: string;
  entity?: string;
  message?: string;
}) {
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
      message: result.message ?? "Conflict."
    });
  }

  if (result.status === "precondition-failed" || result.status === "has-dependencies") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: result.message ?? "Backup policy precondition failed."
    });
  }
}

export const backupStorageCommandRouter = t.router({
  createVolume: volumesWriteProcedure
    .input(volumeCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await createVolume(input, {
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      throwVolumeMutationError(result);
      return result.volume;
    }),
  updateVolume: volumesWriteProcedure
    .input(volumeUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await updateVolume(input, {
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      throwVolumeMutationError(result);
      return result.volume;
    }),
  deleteVolume: volumesWriteProcedure
    .input(volumeDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await deleteVolume(input.volumeId, {
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      throwVolumeMutationError(result);
      return { deleted: true, volumeId: input.volumeId };
    }),
  createBackupPolicy: backupRunProcedure
    .input(backupPolicyCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await createBackupPolicy(input, {
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      throwBackupPolicyMutationError(result);
      return result.policy;
    }),
  updateBackupPolicy: backupRunProcedure
    .input(backupPolicyUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await updateBackupPolicy(input, {
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      throwBackupPolicyMutationError(result);
      return result.policy;
    }),
  deleteBackupPolicy: backupRunProcedure
    .input(backupPolicyIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await deleteBackupPolicy(input.policyId, {
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      throwBackupPolicyMutationError(result);
      return { deleted: true, policyId: input.policyId };
    }),
  enableBackupSchedule: backupRunProcedure
    .input(backupScheduleEnableInputSchema)
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
    .input(backupPolicyIdInputSchema)
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
    })
});
