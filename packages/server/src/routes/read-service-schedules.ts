import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { listServiceScheduleRuns, listServiceSchedules } from "../db/services/service-schedules";
import { serviceReadProcedure, t } from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";

export const serviceSchedulesReadRouter = t.router({
  serviceSchedules: serviceReadProcedure
    .input(
      z.object({
        serviceId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      return listServiceSchedules({
        teamId,
        serviceId: input.serviceId,
        limit: input.limit
      });
    }),

  serviceScheduleRuns: serviceReadProcedure
    .input(
      z.object({
        scheduleId: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await listServiceScheduleRuns({
        teamId,
        scheduleId: input.scheduleId,
        limit: input.limit
      });
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service schedule not found." });
      }
      return result;
    })
});
