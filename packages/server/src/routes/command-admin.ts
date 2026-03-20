import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { registerServer, deleteServer } from "../db/services/servers";
import {
  createProject,
  updateProject,
  deleteProject,
  createEnvironment,
  updateEnvironment,
  deleteEnvironment
} from "../db/services/projects";
import { createService, updateService, deleteService } from "../db/services/services";
import {
  addServiceDomain,
  removeServiceDomain,
  setPrimaryServiceDomain,
  updateServicePortMappings
} from "../db/services/service-domains";
import { updateServiceRuntimeConfig } from "../db/services/service-runtime-config";
import { createAgentPrincipal, generateAgentToken, revokeAgentToken } from "../db/services/agents";
import {
  approveApprovalRequest,
  createApprovalRequest,
  rejectApprovalRequest
} from "../db/services/approvals";
import { resolveTeamIdForUser } from "../db/services/teams";
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

const composeReadinessProbeBaseSchema = {
  port: z.number().int().min(1).max(65535),
  timeoutSeconds: z.number().int().min(1).max(300).optional(),
  intervalSeconds: z.number().int().min(1).max(30).optional()
} as const;

const composeReadinessProbeSchema = z.discriminatedUnion("type", [
  z.object({
    type: z.literal("http"),
    target: z.literal("published-port"),
    ...composeReadinessProbeBaseSchema,
    path: z.string().min(1).max(255),
    host: z.string().min(1).max(255).optional(),
    scheme: z.enum(["http", "https"]).optional(),
    successStatusCodes: z.array(z.number().int().min(100).max(599)).max(20).optional()
  }),
  z.object({
    type: z.literal("http"),
    target: z.literal("internal-network"),
    ...composeReadinessProbeBaseSchema,
    path: z.string().min(1).max(255),
    scheme: z.enum(["http", "https"]).optional(),
    successStatusCodes: z.array(z.number().int().min(100).max(599)).max(20).optional()
  }),
  z.object({
    type: z.literal("tcp"),
    target: z.literal("published-port"),
    ...composeReadinessProbeBaseSchema,
    host: z.string().min(1).max(255).optional()
  }),
  z.object({
    type: z.literal("tcp"),
    target: z.literal("internal-network"),
    ...composeReadinessProbeBaseSchema
  })
]);

const composePreviewConfigSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["branch", "pull-request", "any"]).optional(),
  domainTemplate: z.string().min(1).max(255).optional(),
  staleAfterHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional()
});

const serviceRuntimeVolumeSchema = z.object({
  source: z.string().min(1).max(500),
  target: z.string().min(1).max(500),
  mode: z.enum(["rw", "ro"]).default("rw")
});

const serviceRuntimeRestartPolicySchema = z.object({
  name: z.enum(["always", "unless-stopped", "on-failure", "no"]),
  maxRetries: z.number().int().min(1).max(100).nullable().optional()
});

const serviceRuntimeHealthCheckSchema = z.object({
  command: z.string().min(1).max(2_000),
  intervalSeconds: z.number().int().min(1).max(3_600),
  timeoutSeconds: z.number().int().min(1).max(3_600),
  retries: z.number().int().min(1).max(100),
  startPeriodSeconds: z.number().int().min(1).max(3_600)
});

const serviceRuntimeResourcesSchema = z.object({
  cpuLimitCores: z.number().positive().max(256).nullable().optional(),
  cpuReservationCores: z.number().positive().max(256).nullable().optional(),
  memoryLimitMb: z
    .number()
    .int()
    .min(1)
    .max(1024 * 1024)
    .nullable()
    .optional(),
  memoryReservationMb: z
    .number()
    .int()
    .min(1)
    .max(1024 * 1024)
    .nullable()
    .optional()
});

const servicePortMappingSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  hostPort: z.number().int().min(1).max(65535),
  containerPort: z.number().int().min(1).max(65535),
  protocol: z.enum(["tcp", "udp"]).default("tcp")
});

export const adminRouter = t.router({
  /* ── Server Registration ─────────────────────────────────── */
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

  /* ── Project CRUD ──────────────────────────────────────────── */
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
        repositorySubmodules: z.boolean().optional(),
        repositoryGitLfs: z.boolean().optional(),
        teamId: z.string().min(1).optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const teamId = input.teamId ?? (await resolveTeamIdForUser(ctx.session.user.id));
      if (!teamId) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: "No organization is available for this user."
        });
      }

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
        repositorySubmodules: z.boolean().optional(),
        repositoryGitLfs: z.boolean().optional()
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
        targetServerId: z.string().optional(),
        composeFiles: z.array(z.string().max(500)).max(20).optional(),
        composeProfiles: z.array(z.string().max(100)).max(20).optional()
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
        targetServerId: z.string().optional(),
        composeFiles: z.array(z.string().max(500)).max(20).optional(),
        composeProfiles: z.array(z.string().max(100)).max(20).optional()
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
        readinessProbe: composeReadinessProbeSchema.nullable().optional(),
        preview: composePreviewConfigSchema.nullable().optional(),
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
      if (result.status === "invalid_config") {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
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
        readinessProbe: composeReadinessProbeSchema.nullable().optional(),
        preview: composePreviewConfigSchema.nullable().optional(),
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
      if (result.status === "invalid_config") {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }
      return result.service;
    }),

  updateServiceRuntimeConfig: serviceUpdateProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        volumes: z.array(serviceRuntimeVolumeSchema).max(50).nullable().optional(),
        networks: z.array(z.string().min(1).max(120)).max(50).nullable().optional(),
        restartPolicy: serviceRuntimeRestartPolicySchema.nullable().optional(),
        healthCheck: serviceRuntimeHealthCheckSchema.nullable().optional(),
        resources: serviceRuntimeResourcesSchema.nullable().optional()
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateServiceRuntimeConfig({
        serviceId: input.serviceId,
        volumes: input.volumes,
        networks: input.networks,
        restartPolicy: input.restartPolicy
          ? {
              name: input.restartPolicy.name,
              maxRetries: input.restartPolicy.maxRetries ?? null
            }
          : input.restartPolicy,
        healthCheck: input.healthCheck
          ? {
              command: input.healthCheck.command,
              intervalSeconds: input.healthCheck.intervalSeconds,
              timeoutSeconds: input.healthCheck.timeoutSeconds,
              retries: input.healthCheck.retries,
              startPeriodSeconds: input.healthCheck.startPeriodSeconds
            }
          : input.healthCheck,
        resources: input.resources
          ? {
              cpuLimitCores: input.resources.cpuLimitCores ?? null,
              cpuReservationCores: input.resources.cpuReservationCores ?? null,
              memoryLimitMb: input.resources.memoryLimitMb ?? null,
              memoryReservationMb: input.resources.memoryReservationMb ?? null
            }
          : input.resources,
        ...getActorContext(ctx)
      });

      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }
      if (result.status === "unsupported") {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }

      return result.service;
    }),
  addServiceDomain: serviceUpdateProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        hostname: z.string().min(1).max(253)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await addServiceDomain({
        serviceId: input.serviceId,
        hostname: input.hostname,
        ...getActorContext(ctx)
      });

      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }
      if (result.status === "invalid" || result.status === "conflict") {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }

      return result.state;
    }),
  removeServiceDomain: serviceUpdateProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        domainId: z.string().min(1).max(64)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await removeServiceDomain({
        serviceId: input.serviceId,
        domainId: input.domainId,
        ...getActorContext(ctx)
      });

      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }
      if (result.status === "domain_not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found." });
      }

      return result.state;
    }),
  setPrimaryServiceDomain: serviceUpdateProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        domainId: z.string().min(1).max(64)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await setPrimaryServiceDomain({
        serviceId: input.serviceId,
        domainId: input.domainId,
        ...getActorContext(ctx)
      });

      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }
      if (result.status === "domain_not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Domain not found." });
      }

      return result.state;
    }),
  updateServicePortMappings: serviceUpdateProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        portMappings: z.array(servicePortMappingSchema).max(50)
      })
    )
    .mutation(async ({ ctx, input }) => {
      const result = await updateServicePortMappings({
        serviceId: input.serviceId,
        portMappings: input.portMappings,
        ...getActorContext(ctx)
      });

      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }
      if (result.status === "invalid" || result.status === "conflict") {
        throw new TRPCError({ code: "BAD_REQUEST", message: result.message });
      }

      return result.state;
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
