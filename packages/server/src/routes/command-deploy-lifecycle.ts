import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { buildConfigDiff } from "../db/services/config-diffs";
import { cancelDeployment } from "../db/services/deployments";
import { triggerDeploy } from "../db/services/trigger-deploy";
import { reconcileComposePreviewState } from "../db/services/compose-preview-reconciliation";
import { executeRollback } from "../db/services/execute-rollback";
import { ScopedDeploymentNotFoundError } from "../db/services/scoped-deployments";
import {
  deployCancelProcedure,
  deployReadProcedure,
  deployRollbackProcedure,
  deployStartProcedure,
  getActorContext,
  getDeleteContext,
  t,
  throwOnDeployResultError
} from "../trpc";

const triggerDeployInputSchema = z.object({
  serviceId: z.string().min(1),
  commitSha: z.string().optional(),
  imageTag: z.string().optional(),
  preview: z
    .object({
      target: z.enum(["branch", "pull-request"]),
      branch: z.string().min(1).max(255),
      pullRequestNumber: z.number().int().min(1).optional(),
      action: z.enum(["deploy", "destroy"]).optional()
    })
    .optional()
});

const reconcileComposePreviewsInputSchema = z.object({
  serviceId: z.string().min(1),
  dryRun: z.boolean().optional(),
  limit: z.number().int().min(1).max(100).optional()
});

const rollbackInputSchema = z.object({
  serviceId: z.string().min(1),
  targetDeploymentId: z.string().min(1)
});

const deploymentIdInputSchema = z.object({
  deploymentId: z.string().min(1)
});

const deploymentDiffInputSchema = z.object({
  deploymentIdA: z.string().min(1),
  deploymentIdB: z.string().min(1)
});

export const deployLifecycleCommandRouter = t.router({
  triggerDeploy: deployStartProcedure
    .input(triggerDeployInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await triggerDeploy({
        ...input,
        ...getActorContext(ctx)
      });
      throwOnDeployResultError(result);
      return (result as { deployment: unknown }).deployment;
    }),
  reconcileComposePreviews: deployStartProcedure
    .input(reconcileComposePreviewsInputSchema)
    .mutation(async ({ ctx, input }) => {
      return reconcileComposePreviewState({
        serviceRef: input.serviceId,
        dryRun: input.dryRun,
        limit: input.limit,
        ...getActorContext(ctx)
      });
    }),
  executeRollback: deployRollbackProcedure
    .input(rollbackInputSchema)
    .mutation(async ({ ctx, input }) => {
      const result = await executeRollback({
        ...input,
        ...getActorContext(ctx)
      });
      throwOnDeployResultError(result);
      return (result as { deployment: unknown }).deployment;
    }),
  cancelDeployment: deployCancelProcedure
    .input(deploymentIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = getDeleteContext(ctx);
      const result = await cancelDeployment({
        deploymentId: input.deploymentId,
        cancelledByUserId: actor.userId,
        cancelledByEmail: actor.email,
        cancelledByRole: actor.role
      });

      if (result.status === "not-found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment not found."
        });
      }

      if (result.status === "invalid-state") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `Deployment is already ${result.currentStatus}; only queued or running deployments can be cancelled.`
        });
      }

      return result;
    }),
  deploymentDiff: deployReadProcedure
    .input(deploymentDiffInputSchema)
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
