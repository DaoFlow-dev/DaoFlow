import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createDeploymentRecord } from "../db/services/deployments";
import {
  approveApprovalRequest,
  createApprovalRequest,
  rejectApprovalRequest
} from "../db/services/approvals";
import { queueBackupRestore, triggerBackupRun } from "../db/services/backups";
import { queueComposeRelease } from "../db/services/compose";
import { upsertEnvironmentVariable } from "../db/services/envvars";
import {
  completeExecutionJob,
  dispatchExecutionJob,
  failExecutionJob
} from "../db/services/execution";
import { registerServer } from "../db/services/servers";
import {
  t,
  adminProcedure,
  deployProcedure,
  executionProcedure,
  planningProcedure,
  throwOnOperationError
} from "../trpc";
import type { Context } from "../context";
import type { AppRole } from "@daoflow/shared";

/** Extract common actor fields from a resolved tRPC context. */
function actorFromCtx(ctx: Context & { session: NonNullable<Context["session"]>; role: AppRole }) {
  return {
    requestedByUserId: ctx.session.user.id,
    requestedByEmail: ctx.session.user.email,
    requestedByRole: ctx.role
  };
}

export const commandRouter = t.router({
  registerServer: adminProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        host: z.string().min(1).max(120),
        region: z.string().min(1).max(60),
        sshPort: z.number().int().min(1).max(65535),
        kind: z.enum(["docker-engine", "docker-swarm-manager"])
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await registerServer({
        ...input,
        ...actorFromCtx(ctx)
      });

      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A server with this ${result.conflictField} already exists.`
        });
      }

      return result.server;
    }),
  createDeploymentRecord: deployProcedure
    .input(
      z.object({
        projectName: z.string().min(1).max(80),
        environmentName: z.string().min(1).max(80),
        serviceName: z.string().min(1).max(80),
        sourceType: z.enum(["compose", "dockerfile", "image"]),
        targetServerId: z.string().min(1),
        commitSha: z
          .string()
          .regex(/^[a-f0-9]{7,40}$/i)
          .optional()
          .default(""),
        imageTag: z.string().max(160).optional().default(""),
        steps: z
          .array(
            z.object({
              label: z.string().min(1).max(80),
              detail: z.string().min(1).max(280)
            })
          )
          .min(1)
          .max(6)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const deployment = await createDeploymentRecord({
        ...input,
        ...actorFromCtx(ctx)
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Target server not found."
        });
      }

      return deployment;
    }),
  queueComposeRelease: deployProcedure
    .input(
      z.object({
        composeServiceId: z.string().min(1),
        commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i),
        imageTag: z.string().min(1).max(160).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const deployment = await queueComposeRelease({
        ...input,
        ...actorFromCtx(ctx)
      });

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Compose release target not found."
        });
      }

      return deployment;
    }),
  upsertEnvironmentVariable: deployProcedure
    .input(
      z.object({
        environmentId: z.string().min(1),
        key: z
          .string()
          .regex(/^[A-Z_][A-Z0-9_]*$/)
          .max(80),
        value: z.string().min(1).max(4000),
        isSecret: z.boolean(),
        category: z.enum(["runtime", "build"]),
        branchPattern: z.string().max(120).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const variable = await upsertEnvironmentVariable({
        ...input,
        updatedByUserId: ctx.session.user.id,
        updatedByEmail: ctx.session.user.email,
        updatedByRole: ctx.role
      });

      if (!variable) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment record not found."
        });
      }

      return variable;
    }),
  requestApproval: planningProcedure
    .input(
      z.discriminatedUnion("actionType", [
        z.object({
          actionType: z.literal("compose-release"),
          composeServiceId: z.string().min(1),
          commitSha: z.string().regex(/^[a-f0-9]{7,40}$/i),
          imageTag: z.string().min(1).max(160).optional(),
          reason: z.string().min(12).max(280)
        }),
        z.object({
          actionType: z.literal("backup-restore"),
          backupRunId: z.string().min(1),
          reason: z.string().min(12).max(280)
        })
      ])
    )
    .mutation(async ({ ctx, input }) => {
      const request = await createApprovalRequest({
        ...input,
        ...actorFromCtx(ctx)
      });

      if (!request) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            input.actionType === "compose-release"
              ? "Compose release target not found."
              : "Only successful backup runs with an artifact can be submitted for approval."
        });
      }

      return request;
    }),
  approveApprovalRequest: executionProcedure
    .input(
      z.object({
        requestId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await approveApprovalRequest(
        input.requestId,
        ctx.session.user.id,
        ctx.session.user.email,
        ctx.role
      );

      throwOnOperationError(result, "Approval request");
      return result.request;
    }),
  rejectApprovalRequest: executionProcedure
    .input(
      z.object({
        requestId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await rejectApprovalRequest(
        input.requestId,
        ctx.session.user.id,
        ctx.session.user.email,
        ctx.role
      );

      throwOnOperationError(result, "Approval request");
      return result.request;
    }),
  triggerBackupRun: executionProcedure
    .input(
      z.object({
        policyId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const run = await triggerBackupRun(
        input.policyId,
        ctx.session.user.id,
        ctx.session.user.email,
        ctx.role
      );

      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup policy not found."
        });
      }

      return run;
    }),
  queueBackupRestore: executionProcedure
    .input(
      z.object({
        backupRunId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const restore = await queueBackupRestore(
        input.backupRunId,
        ctx.session.user.id,
        ctx.session.user.email,
        ctx.role
      );

      if (!restore) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Only successful backup runs with an artifact can be restored."
        });
      }

      return restore;
    }),
  dispatchExecutionJob: executionProcedure
    .input(
      z.object({
        jobId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await dispatchExecutionJob(
        input.jobId,
        ctx.session.user.id,
        ctx.session.user.email,
        ctx.role
      );

      throwOnOperationError(result, "Execution job");
      return result.job;
    }),
  completeExecutionJob: executionProcedure
    .input(
      z.object({
        jobId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await completeExecutionJob(
        input.jobId,
        ctx.session.user.id,
        ctx.session.user.email,
        ctx.role
      );

      throwOnOperationError(result, "Execution job");
      return result.job;
    }),
  failExecutionJob: executionProcedure
    .input(
      z.object({
        jobId: z.string().min(1),
        reason: z.string().min(1).max(280).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await failExecutionJob(
        input.jobId,
        ctx.session.user.id,
        ctx.session.user.email,
        ctx.role,
        input.reason
      );

      throwOnOperationError(result, "Execution job");
      return result.job;
    })
});
