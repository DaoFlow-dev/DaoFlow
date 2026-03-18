import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { buildDeploymentPlan } from "../db/services/deployment-plans";
import { t, deployReadProcedure } from "../trpc";

export const planningRouter = t.router({
  deploymentPlan: deployReadProcedure
    .input(
      z.object({
        service: z.string().min(1),
        server: z.string().min(1).optional(),
        image: z.string().min(1).max(255).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        return await buildDeploymentPlan({
          serviceRef: input.service,
          serverRef: input.server,
          imageTag: input.image,
          requestedByUserId: ctx.session.user.id
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    })
});
