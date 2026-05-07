import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  DEVELOPMENT_TASK_STATUSES,
  DEVELOPMENT_TASK_RUN_STATUSES
} from "../db/schema/development-tasks";
import {
  getDevelopmentTaskDetails,
  listDevelopmentTasks,
  listSandboxRunnerProfiles
} from "../db/services/development-tasks";
import { resolveTeamIdForUser } from "../db/services/teams";
import { deployReadProcedure, protectedProcedure, t } from "../trpc";

async function requireViewerTeamId(userId: string) {
  const teamId = await resolveTeamIdForUser(userId);
  if (!teamId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No organization is available for this user."
    });
  }

  return teamId;
}

export const developmentTaskReadRouter = t.router({
  developmentTasks: deployReadProcedure
    .input(
      z.object({
        status: z.enum(DEVELOPMENT_TASK_STATUSES).optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireViewerTeamId(ctx.session.user.id);
      return listDevelopmentTasks({
        status: input.status,
        teamId,
        limit: input.limit ?? 24
      });
    }),

  developmentTaskDetails: deployReadProcedure
    .input(z.object({ taskId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const teamId = await requireViewerTeamId(ctx.session.user.id);
      const details = await getDevelopmentTaskDetails(input.taskId, teamId);
      if (!details) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Development task not found."
        });
      }

      return details;
    }),

  sandboxRunnerProfiles: deployReadProcedure
    .input(
      z.object({
        status: z.enum(["enabled", "disabled"]).optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireViewerTeamId(ctx.session.user.id);
      return listSandboxRunnerProfiles({
        status: input.status,
        teamId,
        limit: input.limit ?? 24
      });
    }),

  developmentTaskStatuses: protectedProcedure.query(() => ({
    tasks: [...DEVELOPMENT_TASK_STATUSES],
    runs: [...DEVELOPMENT_TASK_RUN_STATUSES]
  }))
});
