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
import {
  assertBackupDestinationScope,
  assertBackupPolicyScope,
  assertVolumeScope
} from "./backup-scope";
import { getServiceForTeam } from "../db/services/service-access";
import { resolveTeamIdForUser } from "../db/services/teams";
import { serviceAccessActor } from "./service-scope";

function toStorageActor(actor: ReturnType<typeof getActorContext>) {
  return {
    userId: actor.requestedByUserId,
    email: actor.requestedByEmail,
    role: actor.requestedByRole
  };
}

async function assertVolumeServiceScope(input: {
  ctx: Parameters<typeof serviceAccessActor>[0];
  serviceId?: string;
  action: string;
  permissionScope: string;
}) {
  if (!input.serviceId) {
    return;
  }

  const teamId = await resolveTeamIdForUser(input.ctx.session.user.id);
  if (!teamId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No organization is available for this user."
    });
  }

  const service = await getServiceForTeam({
    serviceId: input.serviceId,
    teamId,
    actor: serviceAccessActor(input.ctx),
    action: input.action,
    permissionScope: input.permissionScope
  });
  if (!service) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
  }
}

function throwVolumeMutationError(result: { status: string; entity?: string; message?: string }) {
  if (result.status === "not-found") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message:
        result.entity === "volume"
          ? "Volume not found."
          : result.entity === "service"
            ? "Service not found."
            : "Server not found."
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
      await assertVolumeServiceScope({
        ctx,
        serviceId: input.serviceId,
        action: "volume.create.denied",
        permissionScope: "volumes:write"
      });
      const result = await createVolume(input, toStorageActor(getActorContext(ctx)));
      throwVolumeMutationError(result);
      if (!("volume" in result) || !result.volume) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Volume creation did not return a volume."
        });
      }
      return result.volume;
    }),
  updateVolume: volumesWriteProcedure
    .input(volumeUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertVolumeScope({
        ctx,
        volumeId: input.volumeId,
        action: "volume.update.denied",
        permissionScope: "volumes:write"
      });
      await assertVolumeServiceScope({
        ctx,
        serviceId: input.serviceId,
        action: "volume.update.denied",
        permissionScope: "volumes:write"
      });
      const result = await updateVolume(input, toStorageActor(getActorContext(ctx)));
      throwVolumeMutationError(result);
      if (!("volume" in result) || !result.volume) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Volume update did not return a volume."
        });
      }
      return result.volume;
    }),
  deleteVolume: volumesWriteProcedure
    .input(volumeDeleteInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertVolumeScope({
        ctx,
        volumeId: input.volumeId,
        action: "volume.delete.denied",
        permissionScope: "volumes:write"
      });
      const result = await deleteVolume(input.volumeId, toStorageActor(getActorContext(ctx)));
      throwVolumeMutationError(result);
      return { deleted: true, volumeId: input.volumeId };
    }),
  createBackupPolicy: backupRunProcedure
    .input(backupPolicyCreateInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertVolumeScope({
        ctx,
        volumeId: input.volumeId,
        action: "backup.policy-create.denied",
        permissionScope: "backup:run"
      });
      if (input.destinationId) {
        await assertBackupDestinationScope({
          ctx,
          destinationId: input.destinationId,
          action: "backup.policy-create.denied",
          permissionScope: "backup:run"
        });
      }
      const result = await createBackupPolicy(input, toStorageActor(getActorContext(ctx)));
      throwBackupPolicyMutationError(result);
      if (!("policy" in result) || !result.policy) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Backup policy creation did not return a policy."
        });
      }
      return result.policy;
    }),
  updateBackupPolicy: backupRunProcedure
    .input(backupPolicyUpdateInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertBackupPolicyScope({
        ctx,
        policyId: input.policyId,
        action: "backup.policy-update.denied",
        permissionScope: "backup:run"
      });
      if (input.volumeId) {
        await assertVolumeScope({
          ctx,
          volumeId: input.volumeId,
          action: "backup.policy-update.denied",
          permissionScope: "backup:run"
        });
      }
      if (input.destinationId) {
        await assertBackupDestinationScope({
          ctx,
          destinationId: input.destinationId,
          action: "backup.policy-update.denied",
          permissionScope: "backup:run"
        });
      }
      const result = await updateBackupPolicy(input, toStorageActor(getActorContext(ctx)));
      throwBackupPolicyMutationError(result);
      if (!("policy" in result) || !result.policy) {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Backup policy update did not return a policy."
        });
      }
      return result.policy;
    }),
  deleteBackupPolicy: backupRunProcedure
    .input(backupPolicyIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertBackupPolicyScope({
        ctx,
        policyId: input.policyId,
        action: "backup.policy-delete.denied",
        permissionScope: "backup:run"
      });
      const result = await deleteBackupPolicy(input.policyId, toStorageActor(getActorContext(ctx)));
      throwBackupPolicyMutationError(result);
      return { deleted: true, policyId: input.policyId };
    }),
  enableBackupSchedule: backupRunProcedure
    .input(backupScheduleEnableInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertBackupPolicyScope({
        ctx,
        policyId: input.policyId,
        action: "backup.schedule-enable.denied",
        permissionScope: "backup:run"
      });
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
      await assertBackupPolicyScope({
        ctx,
        policyId: input.policyId,
        action: "backup.schedule-disable.denied",
        permissionScope: "backup:run"
      });
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
