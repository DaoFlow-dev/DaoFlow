import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createServiceSchedule,
  createServiceScheduleRun,
  deleteServiceSchedule,
  setServiceScheduleState
} from "../db/services/service-schedules";
import { executeServiceScheduleRun } from "../worker";
import { getActorContext, t } from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";
import { teamScopedServiceUpdateProcedure } from "./service-scope";

function throwScheduleError(result: { status: string; message?: string }): never {
  if (result.status === "not_found") {
    throw new TRPCError({ code: "NOT_FOUND", message: "Service schedule not found." });
  }
  if (result.status === "invalid" || result.status === "invalid_state") {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: result.message ?? "Service schedule input is invalid."
    });
  }
  throw new TRPCError({ code: "INTERNAL_SERVER_ERROR", message: "Schedule operation failed." });
}

export const adminServiceSchedulesRouter = t.router({
  createServiceSchedule: teamScopedServiceUpdateProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        name: z.string().min(1).max(100),
        command: z.string().min(1).max(4000),
        cronExpression: z.string().min(1).max(120),
        timezone: z.string().min(1).max(80).optional(),
        retentionCount: z.number().int().min(1).max(100).optional(),
        notifyOnFailure: z.boolean().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await createServiceSchedule({
        ...input,
        teamId,
        actor: getActorContext(ctx)
      });
      if (result.status !== "ok") throwScheduleError(result);
      return result.schedule;
    }),

  setServiceScheduleState: teamScopedServiceUpdateProcedure
    .input(z.object({ scheduleId: z.string().min(1), state: z.enum(["pause", "resume"]) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await setServiceScheduleState({
        ...input,
        teamId,
        actor: getActorContext(ctx)
      });
      if (result.status !== "ok") throwScheduleError(result);
      return result.schedule;
    }),

  deleteServiceSchedule: teamScopedServiceUpdateProcedure
    .input(z.object({ scheduleId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await deleteServiceSchedule({
        ...input,
        teamId,
        actor: getActorContext(ctx)
      });
      if (result.status !== "ok") throwScheduleError(result);
      return result;
    }),

  runServiceScheduleNow: teamScopedServiceUpdateProcedure
    .input(z.object({ scheduleId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await createServiceScheduleRun({
        ...input,
        teamId,
        triggerKind: "manual",
        actor: getActorContext(ctx)
      });
      if (result.status !== "ok") throwScheduleError(result);

      const completed = await executeServiceScheduleRun(result.run.id);
      return completed ?? result.run;
    })
});
