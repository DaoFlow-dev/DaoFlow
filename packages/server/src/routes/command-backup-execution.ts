import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { queueBackupRestore, triggerBackupRun } from "../db/services/backups";
import { BackupVerificationEligibilityError } from "../db/services/backup-restores";
import { backupRestoreProcedure, backupRunProcedure, getActorContext, t } from "../trpc";
import { assertBackupPolicyScope, assertBackupRunScope } from "./backup-scope";

const backupRunIdInputSchema = z.object({
  backupRunId: z.string().min(1)
});

const backupPolicyIdInputSchema = z.object({
  policyId: z.string().min(1)
});

export const backupExecutionCommandRouter = t.router({
  triggerBackupRun: backupRunProcedure
    .input(backupPolicyIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertBackupPolicyScope({
        ctx,
        policyId: input.policyId,
        action: "backup.run.denied",
        permissionScope: "backup:run"
      });
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
    .input(backupRunIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertBackupRunScope({
        ctx,
        backupRunId: input.backupRunId,
        action: "backup.restore.denied",
        permissionScope: "backup:restore"
      });
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
  triggerTestRestore: backupRestoreProcedure
    .input(backupRunIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertBackupRunScope({
        ctx,
        backupRunId: input.backupRunId,
        action: "backup.test-restore.denied",
        permissionScope: "backup:restore"
      });
      const actor = getActorContext(ctx);
      let restore;
      try {
        restore = await queueBackupRestore(
          input.backupRunId,
          actor.requestedByUserId,
          actor.requestedByEmail,
          actor.requestedByRole,
          { testRestore: true }
        );
      } catch (error) {
        if (error instanceof BackupVerificationEligibilityError) {
          throw new TRPCError({ code: "BAD_REQUEST", message: error.message });
        }
        throw error;
      }

      if (!restore) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only successful backup runs with an artifact can be test-restored."
        });
      }

      return restore;
    }),
  triggerBackupNow: backupRunProcedure
    .input(backupPolicyIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      await assertBackupPolicyScope({
        ctx,
        policyId: input.policyId,
        action: "backup.run.denied",
        permissionScope: "backup:run"
      });
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
