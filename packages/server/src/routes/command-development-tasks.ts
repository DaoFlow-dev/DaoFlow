import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  cancelDevelopmentTask,
  retryDevelopmentTask
} from "../db/services/development-task-lifecycle";
import { resolveTeamIdForUser } from "../db/services/teams";
import {
  deployCancelProcedure,
  deployStartProcedure,
  getActorContext,
  t,
  throwOnOperationError
} from "../trpc";

const developmentTaskIdInputSchema = z.object({
  taskId: z.string().min(1)
});

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

export const developmentTaskCommandRouter = t.router({
  cancelDevelopmentTask: deployCancelProcedure
    .input(developmentTaskIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireViewerTeamId(ctx.session.user.id);
      const actor = getActorContext(ctx);
      const result = await cancelDevelopmentTask({
        taskId: input.taskId,
        teamId,
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      throwOnOperationError(result, "Development task");
      return result;
    }),

  retryDevelopmentTask: deployStartProcedure
    .input(developmentTaskIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireViewerTeamId(ctx.session.user.id);
      const actor = getActorContext(ctx);
      const result = await retryDevelopmentTask({
        taskId: input.taskId,
        teamId,
        userId: actor.requestedByUserId,
        email: actor.requestedByEmail,
        role: actor.requestedByRole
      });
      throwOnOperationError(result, "Development task");
      return result;
    })
});
