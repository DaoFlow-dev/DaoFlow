import { z } from "zod";
import { listProviderFeedbackForTeam } from "../db/services/provider-feedback-read";
import { providerFeedbackStates } from "../db/services/provider-feedback-types";
import { deployReadProcedure, t } from "../trpc";
import { requireActorTeamId } from "./team-scope";

export const providerFeedbackReadRouter = t.router({
  providerFeedback: deployReadProcedure
    .input(
      z.object({
        states: z
          .array(z.enum(providerFeedbackStates))
          .max(providerFeedbackStates.length)
          .optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      return listProviderFeedbackForTeam({
        teamId,
        states: input.states,
        limit: input.limit ?? 20
      });
    })
});
