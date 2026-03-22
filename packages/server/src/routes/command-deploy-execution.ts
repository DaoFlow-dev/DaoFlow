import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createDeploymentRecord } from "../db/services/deployments";
import { dispatchDeploymentExecution } from "../db/services/deployment-dispatch";
import { queueComposeRelease } from "../db/services/compose";
import {
  completeExecutionJob,
  dispatchExecutionJob,
  failExecutionJob
} from "../db/services/execution";
import { deployStartProcedure, getActorContext, t, throwOnOperationError } from "../trpc";

const deploymentRecordInputSchema = z.object({
  projectName: z.string().min(1).max(80),
  environmentName: z.string().min(1).max(80),
  serviceName: z.string().min(1).max(80),
  sourceType: z.enum(["compose", "dockerfile", "image"]),
  targetServerId: z.string().min(1),
  commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i),
  imageTag: z.string().min(1).max(160),
  steps: z
    .array(
      z.object({
        label: z.string().min(1).max(80),
        detail: z.string().min(1).max(280)
      })
    )
    .min(1)
    .max(6)
});

const composeReleaseInputSchema = z.object({
  composeServiceId: z.string().min(1),
  commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i),
  imageTag: z.string().min(1).max(160).optional()
});

const executionJobIdInputSchema = z.object({
  jobId: z.string().min(1)
});

const executionJobFailureInputSchema = executionJobIdInputSchema.extend({
  reason: z.string().min(1).max(280).optional()
});

export const deployExecutionCommandRouter = t.router({
  createDeploymentRecord: deployStartProcedure
    .input(deploymentRecordInputSchema)
    .mutation(async ({ ctx, input }) => {
      const deployment = await createDeploymentRecord({
        ...input,
        ...getActorContext(ctx)
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Target server not found."
        });
      }

      await dispatchDeploymentExecution(deployment);
      return deployment;
    }),
  queueComposeRelease: deployStartProcedure
    .input(composeReleaseInputSchema)
    .mutation(async ({ ctx, input }) => {
      const deployment = await queueComposeRelease({
        ...input,
        ...getActorContext(ctx)
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Compose release target not found."
        });
      }

      return deployment;
    }),
  dispatchExecutionJob: deployStartProcedure
    .input(executionJobIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await dispatchExecutionJob(
        input.jobId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      throwOnOperationError(result, "Execution job");
      return result.job;
    }),
  completeExecutionJob: deployStartProcedure
    .input(executionJobIdInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await completeExecutionJob(
        input.jobId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      throwOnOperationError(result, "Execution job");
      return result.job;
    }),
  failExecutionJob: deployStartProcedure
    .input(executionJobFailureInputSchema)
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await failExecutionJob(
        input.jobId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole,
        input.reason
      );

      throwOnOperationError(result, "Execution job");
      return result.job;
    })
});
