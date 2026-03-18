import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { buildConfigDiff } from "../db/services/config-diffs";
import { ScopedDeploymentNotFoundError } from "../db/services/scoped-deployments";
import { buildDeploymentPlan } from "../db/services/deployment-plans";
import { buildRollbackPlan } from "../db/services/rollback-plans";
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
    }),
  rollbackPlan: deployReadProcedure
    .input(
      z.object({
        service: z.string().min(1),
        target: z.string().min(1).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        return await buildRollbackPlan({
          serviceRef: input.service,
          targetDeploymentId: input.target,
          requestedByUserId: ctx.session.user.id
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }),
  configDiff: deployReadProcedure
    .input(
      z.object({
        deploymentIdA: z.string().min(1),
        deploymentIdB: z.string().min(1)
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        const diff = await buildConfigDiff({
          deploymentIdA: input.deploymentIdA,
          deploymentIdB: input.deploymentIdB,
          requestedByUserId: ctx.session.user.id
        });

        if (!diff) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: "One or both deployments not found."
          });
        }

        return diff;
      } catch (error) {
        if (error instanceof TRPCError) {
          throw error;
        }
        if (error instanceof ScopedDeploymentNotFoundError) {
          throw new TRPCError({
            code: "NOT_FOUND",
            message: error.message
          });
        }

        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    })
});
