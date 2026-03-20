import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { buildComposeDeploymentPlan } from "../db/services/compose-deployment-plans";
import { buildConfigDiff } from "../db/services/config-diffs";
import { ScopedDeploymentNotFoundError } from "../db/services/scoped-deployments";
import { buildDeploymentPlan } from "../db/services/deployment-plans";
import { buildRollbackPlan } from "../db/services/rollback-plans";
import { t, deployReadProcedure } from "../trpc";

export const planningRouter = t.router({
  composeDeploymentPlan: deployReadProcedure
    .input(
      z.object({
        server: z.string().min(1),
        compose: z.string().min(1).max(1_000_000),
        composeFiles: z
          .array(
            z.object({
              path: z.string().min(1).max(500),
              contents: z.string().min(1).max(1_000_000)
            })
          )
          .max(20)
          .optional(),
        composeProfiles: z.array(z.string().min(1).max(100)).max(20).optional(),
        composePath: z.string().min(1).max(500).optional(),
        contextPath: z.string().min(1).max(500).optional(),
        repoDefaultContent: z.string().max(200_000).optional(),
        localBuildContexts: z
          .array(
            z.object({
              serviceName: z.string().min(1).max(80),
              context: z.string().min(1).max(500),
              dockerfile: z.string().min(1).max(500).nullable().optional()
            })
          )
          .max(50),
        requiresContextUpload: z.boolean(),
        contextBundle: z
          .object({
            fileCount: z.number().int().nonnegative(),
            sizeBytes: z.number().int().nonnegative(),
            includedOverrides: z.array(z.string().min(1).max(500)).max(200)
          })
          .nullable()
          .optional(),
        contextBundleError: z.string().min(1).max(500).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      try {
        return await buildComposeDeploymentPlan({
          composeContent: input.compose,
          composeFiles: input.composeFiles,
          composeProfiles: input.composeProfiles,
          composePath: input.composePath,
          contextPath: input.contextPath,
          repoDefaultContent: input.repoDefaultContent,
          serverRef: input.server,
          localBuildContexts: input.localBuildContexts,
          requiresContextUpload: input.requiresContextUpload,
          contextBundle: input.contextBundle,
          contextBundleError: input.contextBundleError,
          requestedByUserId: ctx.session.user.id
        });
      } catch (error) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: error instanceof Error ? error.message : String(error)
        });
      }
    }),
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
