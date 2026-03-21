import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  createEnvironment,
  createProject,
  deleteEnvironment,
  deleteProject,
  updateEnvironment,
  updateProject
} from "../db/services/projects";
import { deleteServer, registerServer } from "../db/services/servers";
import {
  deployStartProcedure,
  getActorContext,
  serverWriteProcedure,
  serviceUpdateProcedure,
  t
} from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";

export const adminServerProjectRouter = t.router({
  registerServer: serverWriteProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        host: z.string().min(1).max(120),
        region: z.string().min(1).max(60),
        sshPort: z.number().int().min(1).max(65535),
        sshUser: z.string().min(1).max(80).optional(),
        sshPrivateKey: z.string().min(1).max(20_000).optional(),
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

  deleteServer: serverWriteProcedure
    .input(z.object({ serverId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const result = await deleteServer({
        serverId: input.serverId,
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

      if (result.status === "not-found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Server not found." });
      }

      if (result.status === "has-dependencies") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: result.message
        });
      }

      return { deleted: true, serverName: result.serverName };
    }),

  createProject: deployStartProcedure
    .input(
      z.object({
        name: z.string().min(1).max(80),
        description: z.string().max(500).optional(),
        repoUrl: z.string().max(300).optional(),
        repoFullName: z.string().max(255).optional(),
        composePath: z.string().max(500).optional(),
        composeFiles: z.array(z.string().max(500)).max(20).optional(),
        composeProfiles: z.array(z.string().max(100)).max(20).optional(),
        gitProviderId: z.string().max(32).optional(),
        gitInstallationId: z.string().max(32).optional(),
        defaultBranch: z.string().max(80).optional(),
        autoDeploy: z.boolean().optional(),
        autoDeployBranch: z.string().max(120).optional(),
        webhookWatchedPaths: z.array(z.string().max(500)).max(50).optional(),
        repositorySubmodules: z.boolean().optional(),
        repositoryGitLfs: z.boolean().optional(),
        teamId: z.string().min(1).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = input.teamId ?? (await requireActorTeamId(ctx.session.user.id));

      const result = await createProject({
        ...input,
        teamId,
        ...getActorContext(ctx)
      });
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `A project named "${input.name}" already exists.`
        });
      }
      if (result.status === "invalid_source") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.message
        });
      }
      if (result.status === "provider_unavailable") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: result.message
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
        repoFullName: z.string().max(255).optional(),
        composePath: z.string().max(500).optional(),
        composeFiles: z.array(z.string().max(500)).max(20).optional(),
        composeProfiles: z.array(z.string().max(100)).max(20).optional(),
        gitProviderId: z.string().max(32).optional(),
        gitInstallationId: z.string().max(32).optional(),
        defaultBranch: z.string().max(80).optional(),
        autoDeploy: z.boolean().optional(),
        autoDeployBranch: z.string().max(120).optional(),
        webhookWatchedPaths: z.array(z.string().max(500)).max(50).optional(),
        repositorySubmodules: z.boolean().optional(),
        repositoryGitLfs: z.boolean().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await updateProject({
        ...input,
        teamId,
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
      if (result.status === "invalid_source") {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message: result.message
        });
      }
      if (result.status === "provider_unavailable") {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: result.message
        });
      }
      return result.project;
    }),

  deleteProject: serviceUpdateProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await deleteProject({
        ...input,
        teamId,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
      }
      return { deleted: true };
    }),

  createEnvironment: deployStartProcedure
    .input(
      z.object({
        projectId: z.string().min(1),
        name: z.string().min(1).max(80),
        targetServerId: z.string().optional(),
        composeFiles: z.array(z.string().max(500)).max(20).optional(),
        composeProfiles: z.array(z.string().max(100)).max(20).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await createEnvironment({
        ...input,
        teamId,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Parent project not found." });
      }
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `An environment named "${input.name}" already exists in this project.`
        });
      }
      return result.environment;
    }),

  updateEnvironment: serviceUpdateProcedure
    .input(
      z.object({
        environmentId: z.string().min(1),
        name: z.string().min(1).max(80).optional(),
        status: z.string().max(40).optional(),
        targetServerId: z.string().optional(),
        composeFiles: z.array(z.string().max(500)).max(20).optional(),
        composeProfiles: z.array(z.string().max(100)).max(20).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await updateEnvironment({
        ...input,
        teamId,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found." });
      }
      if (result.status === "conflict") {
        throw new TRPCError({
          code: "CONFLICT",
          message: `An environment named "${input.name}" already exists in this project.`
        });
      }
      return result.environment;
    }),

  deleteEnvironment: serviceUpdateProcedure
    .input(z.object({ environmentId: z.string().min(1) }))
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await deleteEnvironment({
        ...input,
        teamId,
        ...getActorContext(ctx)
      });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Environment not found." });
      }
      return { deleted: true };
    })
});
