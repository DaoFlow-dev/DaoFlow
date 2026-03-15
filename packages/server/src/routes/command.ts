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
  createProject,
  updateProject,
  deleteProject,
  createEnvironment,
  updateEnvironment,
  deleteEnvironment
} from "../db/services/projects";
import {
  t,
  adminProcedure,
  deployProcedure,
  executionProcedure,
  planningProcedure,
  throwOnOperationError
} from "../trpc";

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
        requestedByUserId: ctx.session.user.id,
        requestedByEmail: ctx.session.user.email,
        requestedByRole: ctx.role
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
        requestedByUserId: ctx.session.user.id,
        requestedByEmail: ctx.session.user.email,
        requestedByRole: ctx.role
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
        requestedByUserId: ctx.session.user.id,
        requestedByEmail: ctx.session.user.email,
        requestedByRole: ctx.role
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
        requestedByUserId: ctx.session.user.id,
        requestedByEmail: ctx.session.user.email,
        requestedByRole: ctx.role
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
    }),

  /* ── Project CRUD ──────────────────────────────────────────────── */
  createProject: deployProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(500).optional(),
        repoUrl: z.string().max(300).optional(),
        defaultBranch: z.string().max(80).optional(),
        teamId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createProject({
        ...input,
        requestedByUserId: ctx.session.user.id,
        requestedByEmail: ctx.session.user.email,
        requestedByRole: ctx.role
      });
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A project named "${input.name}" already exists.`
        });
      }
      return result.project;
    }),

  updateProject: deployProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1).max(80).optional(),
        description: z.string().max(500).optional(),
        repoUrl: z.string().max(300).optional(),
        defaultBranch: z.string().max(80).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateProject({
        ...input,
        requestedByUserId: ctx.session.user.id,
        requestedByEmail: ctx.session.user.email,
        requestedByRole: ctx.role
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
      }
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A project named "${input.name}" already exists.`
        });
      }
      return result.project;
    }),

  deleteProject: adminProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteProject({
        ...input,
        requestedByUserId: ctx.session.user.id,
        requestedByEmail: ctx.session.user.email,
        requestedByRole: ctx.role
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
      }
      return { deleted: true };
    }),

  /* ── Environment CRUD ──────────────────────────────────────────── */
  createEnvironment: deployProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1).max(80),
        targetServerId: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createEnvironment({
        ...input,
        requestedByUserId: ctx.session.user.id,
        requestedByEmail: ctx.session.user.email,
        requestedByRole: ctx.role
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Parent project not found." });
      }
      return result.environment;
    }),

  updateEnvironment: deployProcedure
    .input(
      z.object({
        environmentId: z.string().min(1),
        name: z.string().min(1).max(80).optional(),
        status: z.string().max(40).optional(),
        targetServerId: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateEnvironment({
        ...input,
        requestedByUserId: ctx.session.user.id,
        requestedByEmail: ctx.session.user.email,
        requestedByRole: ctx.role
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found." });
      }
      return result.environment;
    }),

  deleteEnvironment: adminProcedure
    .input(z.object({ environmentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteEnvironment({
        ...input,
        requestedByUserId: ctx.session.user.id,
        requestedByEmail: ctx.session.user.email,
        requestedByRole: ctx.role
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found." });
      }
      return { deleted: true };
    })
});
