import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { registerServer } from "../db/services/servers";
import {
  createProject,
  updateProject,
  deleteProject,
  createEnvironment,
  updateEnvironment,
  deleteEnvironment
} from "../db/services/projects";
import { createService, updateService, deleteService } from "../db/services/services";
import { createAgentPrincipal, generateAgentToken, revokeAgentToken } from "../db/services/agents";
import {
  approveApprovalRequest,
  createApprovalRequest,
  rejectApprovalRequest
} from "../db/services/approvals";
import {
  t,
  adminProcedure,
  serverWriteProcedure,
  serviceUpdateProcedure,
  deployStartProcedure,
  approvalsCreateProcedure,
  approvalsDecideProcedure,
  tokensManageProcedure,
  getActorContext,
  throwOnOperationError
} from "../trpc";

export const adminRouter = t.router({
  /* ── Server Registration ─────────────────────────────────── */
  registerServer: serverWriteProcedure
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
        ...getActorContext(ctx)
      });

      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A server with this ${result.conflictField} already exists.`
        });
      }

      return result.server;
    }),

  /* ── Project CRUD ──────────────────────────────────────────── */
  createProject: deployStartProcedure
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
        ...getActorContext(ctx)
      });
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A project named "${input.name}" already exists.`
        });
      }
      return result.project;
    }),

  updateProject: serviceUpdateProcedure
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
        ...getActorContext(ctx)
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
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
      }
      return { deleted: true };
    }),

  /* ── Environment CRUD ─────────────────────────────────────── */
  createEnvironment: deployStartProcedure
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
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Parent project not found." });
      }
      return result.environment;
    }),

  updateEnvironment: serviceUpdateProcedure
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
        ...getActorContext(ctx)
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
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found." });
      }
      return { deleted: true };
    }),

  /* ── Service CRUD ─────────────────────────────────────────── */
  createService: serviceUpdateProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        environmentId: z.string().min(1),
        projectId: z.string().min(1),
        sourceType: z.enum(["compose", "dockerfile", "image"]),
        imageReference: z.string().max(255).optional(),
        dockerfilePath: z.string().max(500).optional(),
        composeServiceName: z.string().max(100).optional(),
        port: z.string().max(20).optional(),
        healthcheckPath: z.string().max(255).optional(),
        targetServerId: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createService({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found." });
      }
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A service with this name already exists in the environment.`
        });
      }
      return result.service;
    }),

  updateService: serviceUpdateProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        name: z.string().min(1).max(80).optional(),
        sourceType: z.enum(["compose", "dockerfile", "image"]).optional(),
        imageReference: z.string().max(255).optional(),
        dockerfilePath: z.string().max(500).optional(),
        composeServiceName: z.string().max(100).optional(),
        port: z.string().max(20).optional(),
        healthcheckPath: z.string().max(255).optional(),
        replicaCount: z.string().max(5).optional(),
        targetServerId: z.string().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateService({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }
      return result.service;
    }),

  deleteService: adminProcedure
    .input(z.object({ serviceId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteService({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }
      return { deleted: true };
    }),

  /* ── Agent Management ─────────────────────────────────────── */
  createAgent: adminProcedure
    .input(
      z
        .object({
          name: z.string().min(1).max(80),
          description: z.string().max(255).optional(),
          scopes: z.array(z.string()).min(1).optional(),
          preset: z.enum(["agent:read-only", "agent:minimal-write", "agent:full"]).optional()
        })
        .refine((d) => d.scopes || d.preset, {
          message: "Either scopes or preset must be provided"
        })
        .refine((d) => !(d.scopes && d.preset), {
          message: "Provide either scopes or preset, not both"
        })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await createAgentPrincipal({
        ...input,
        ...getActorContext(ctx)
      });
      return result.principal;
    }),

  generateAgentToken: tokensManageProcedure
    .input(
      z.object({
        principalId: z.string().min(1),
        tokenName: z.string().min(1).max(80),
        expiresInDays: z.number().int().min(1).max(365).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await generateAgentToken({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Agent not found." });
      }
      return { token: result.token, tokenValue: result.tokenValue };
    }),

  revokeAgentToken: tokensManageProcedure
    .input(z.object({ tokenId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await revokeAgentToken({
        ...input,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Token not found." });
      }
      return { revoked: true };
    }),

  /* ── Approvals ────────────────────────────────────────────── */
  requestApproval: approvalsCreateProcedure
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
        ...getActorContext(ctx)
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
  approveApprovalRequest: approvalsDecideProcedure
    .input(
      z.object({
        requestId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await approveApprovalRequest(
        input.requestId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      throwOnOperationError(result, "Approval request");
      return result.request;
    }),
  rejectApprovalRequest: approvalsDecideProcedure
    .input(
      z.object({
        requestId: z.string().min(1)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const actor = getActorContext(ctx);
      const result = await rejectApprovalRequest(
        input.requestId,
        actor.requestedByUserId,
        actor.requestedByEmail,
        actor.requestedByRole
      );

      throwOnOperationError(result, "Approval request");
      return result.request;
    })
});
