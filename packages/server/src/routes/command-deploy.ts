import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { createDeploymentRecord, cancelDeployment } from "../db/services/deployments";
import { buildConfigDiff } from "../db/services/config-diffs";
import { dispatchDeploymentExecution } from "../db/services/deployment-dispatch";
import { queueComposeRelease } from "../db/services/compose";
import {
  completeExecutionJob,
  dispatchExecutionJob,
  failExecutionJob
} from "../db/services/execution";
import { triggerDeploy } from "../db/services/trigger-deploy";
import { executeRollback } from "../db/services/execute-rollback";
import { upsertEnvironmentVariable, deleteEnvironmentVariable } from "../db/services/envvars";
import { resolveEnvironmentSecretInventory } from "../db/services/onepassword";
import { ScopedDeploymentNotFoundError } from "../db/services/scoped-deployments";
import { resolveTeamIdForUser } from "../db/services/teams";
import {
  t,
  deployStartProcedure,
  deployCancelProcedure,
  deployRollbackProcedure,
  envWriteProcedure,
  secretsReadProcedure,
  deployReadProcedure,
  getActorContext,
  getUpdaterContext,
  throwOnOperationError
} from "../trpc";

export const deployRouter = t.router({
  createDeploymentRecord: deployStartProcedure
    .input(
      z.object({
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
      })
    )
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
  upsertEnvironmentVariable: envWriteProcedure
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
        source: z.enum(["inline", "1password"]).optional(),
        secretRef: z.string().max(500).nullable().optional(),
        branchPattern: z.string().max(120).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const variable = await upsertEnvironmentVariable({
        ...input,
        ...getUpdaterContext(ctx)
      });

      if (!variable) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Environment record not found."
        });
      }

      return variable;
    }),
  resolveEnvironmentSecrets: secretsReadProcedure
    .input(
      z.object({
        environmentId: z.string().min(1)
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await resolveTeamIdForUser(ctx.session.user.id);

      if (!teamId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No organization is available for this user."
        });
      }

      const variables = await resolveEnvironmentSecretInventory(input.environmentId, teamId);

      return {
        ok: true,
        environmentId: input.environmentId,
        resolved: variables.filter((variable) => variable.status === "resolved").length,
        unresolved: variables.filter((variable) => variable.status === "unresolved").length,
        variables
      };
    }),
  dispatchExecutionJob: deployStartProcedure
    .input(
      z.object({
        jobId: z.string().min(1)
      })
    )
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
    .input(
      z.object({
        jobId: z.string().min(1)
      })
    )
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
    .input(
      z.object({
        jobId: z.string().min(1),
        reason: z.string().min(1).max(280).optional()
      })
    )
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
    }),
  triggerDeploy: deployStartProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        commitSha: z.string().optional(),
        imageTag: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await triggerDeploy({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${result.entity ?? "Resource"} not found.`
        });
      }
      if (result.status === "no_server") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "No target server configured for this service or environment."
        });
      }
      if (result.status === "create_failed") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create deployment record."
        });
      }
      if (result.status === "invalid_source") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.message
        });
      }
      return result.deployment;
    }),
  executeRollback: deployRollbackProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        targetDeploymentId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await executeRollback({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `${result.entity ?? "Resource"} not found.`
        });
      }
      if (result.status === "invalid_target") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: "Target deployment is not a successful deployment."
        });
      }
      if (result.status === "outside_retention") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: `Target deployment is outside the retention window (${result.retention} versions).`
        });
      }
      if (result.status === "create_failed") {
        throw new TRPCError({
          code: "INTERNAL_SERVER_ERROR",
          message: "Failed to create rollback deployment."
        });
      }
      return result.deployment;
    }),
  deleteEnvironmentVariable: envWriteProcedure
    .input(
      z.object({
        environmentId: z.string().min(1),
        key: z
          .string()
          .regex(/^[A-Z_][A-Z0-9_]*$/)
          .max(80)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await deleteEnvironmentVariable({
        environmentId: input.environmentId,
        key: input.key,
        deletedByUserId: ctx.session.user.id,
        deletedByEmail: ctx.session.user.email,
        deletedByRole: (ctx.session.user.role ?? "viewer") as
          | "viewer"
          | "owner"
          | "admin"
          | "operator"
          | "developer"
          | "agent"
      });

      if (!result) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: `Environment variable '${input.key}' not found in environment '${input.environmentId}'.`
        });
      }

      return result;
    }),
  cancelDeployment: deployCancelProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await cancelDeployment({
        deploymentId: input.deploymentId,
        cancelledByUserId: ctx.session.user.id,
        cancelledByEmail: ctx.session.user.email,
        cancelledByRole: (ctx.session.user.role ?? "viewer") as
          | "viewer"
          | "owner"
          | "admin"
          | "operator"
          | "developer"
          | "agent"
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
