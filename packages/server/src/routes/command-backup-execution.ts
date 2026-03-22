import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { queueBackupRestore, triggerBackupRun } from "../db/services/backups";
import { backupRestoreProcedure, backupRunProcedure, getActorContext, t } from "../trpc";

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
  triggerBackupNow: backupRunProcedure
    .input(backupPolicyIdInputSchema)
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
