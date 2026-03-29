import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { listApprovalQueue } from "../db/services/approvals";
import { listAuditTrail } from "../db/services/audit";
import { listBackupMetrics, backupDiagnosis } from "../db/services/backups";
import { listDestinations, getDestination } from "../db/services/destinations";
import { listEnvironmentVariableInventory } from "../db/services/envvars";
import { listInfrastructureInventory, listServerReadiness } from "../db/services/servers";
import { getOperationalMaintenanceReport } from "../db/services/operational-maintenance";
import { listProjects, getProject, listEnvironments } from "../db/services/projects";
import { getServiceDomainState } from "../db/services/service-domains";
import { listServices, listServicesByProject, getService } from "../db/services/services";
import { listAgentPrincipals } from "../db/services/agents";
import { listContainerRegistrySummaries } from "../db/services/container-registries";
import {
  listGitInstallationSummaries,
  listGitProviderSummaries
} from "../db/services/git-providers";
import { resolveTeamIdForUser } from "../db/services/teams";
import {
  t,
  protectedProcedure,
  deployReadProcedure,
  envReadProcedure,
  serverWriteProcedure
} from "../trpc";
import { limitInput } from "../schemas";
import { backupReadRouter } from "./read-backups";
import { deploymentReadRouter } from "./read-deployments";

const productPrinciples = [
  "Agent-first, human-supervised",
  "Safety before autonomy",
  "Compose-first before platform sprawl",
  "Transparent infrastructure before magic",
  "Auditability before convenience",
  "Structured output before pretty output"
] as const;

const agentApiLanes = ["read APIs", "planning APIs", "command APIs"] as const;

async function requireViewerTeamId(userId: string) {
  const teamId = await resolveTeamIdForUser(userId);
  if (!teamId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No organization is available for this user."
    });
  }

  return teamId;
}

const coreReadRouter = t.router({
  health: t.procedure.query(() => ({
    status: "healthy" as const,
    service: "daoflow-control-plane",
    timestamp: new Date().toISOString()
  })),
  platformOverview: t.procedure.query(() => ({
    name: "DaoFlow",
    currentSlice: "principal-inventory",
    thesis: "The agentic platform to host deterministic systems — from one prompt to production.",
    tagline: "Open-source Agentic DevOps System — from prompts to production.",
    architecture: {
      controlPlane: ["React web UI", "tRPC API", "typed domain services"],
      executionPlane: [
        "Docker and Compose orchestration workers",
        "log and event collection",
        "backup and restore operations"
      ]
    },
    guardrails: {
      deploymentTargets: ["Docker Engine", "Docker Compose"],
      agentApiLanes,
      productPrinciples
    }
  })),
  roadmap: t.procedure
    .input(
      z.object({
        lane: z.enum(["control-plane", "execution-plane", "agent-safety"]).optional()
      })
    )
    .query(({ input }) => {
      const items = [
        {
          lane: "control-plane",
          title: "Typed deployment records",
          summary: "Track immutable deployments, structured steps, and outcomes."
        },
        {
          lane: "execution-plane",
          title: "SSH-backed Docker worker",
          summary: "Run Docker and Compose operations outside the web process."
        },
        {
          lane: "agent-safety",
          title: "Scoped read and planning APIs",
          summary: "Default external agents to read-only with explicit command gates."
        }
      ] as const;

      if (!input.lane) {
        return items;
      }

      return items.filter((item) => item.lane === input.lane);
    }),
  approvalQueue: protectedProcedure.input(limitInput(40)).query(async ({ input }) => {
    return listApprovalQueue(input.limit ?? 24);
  }),
  infrastructureInventory: protectedProcedure.query(async () => {
    return listInfrastructureInventory();
  }),
  serverReadiness: protectedProcedure.input(limitInput(24)).query(async ({ input }) => {
    return listServerReadiness(input.limit ?? 12);
  }),
  auditTrail: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).optional(),
        since: z
          .string()
          .regex(/^[1-9]\d*[mhdw]$/, {
            message: "Since must be a positive duration like 15m, 1h, 7d, or 2w."
          })
          .optional()
      })
    )
    .query(async ({ input }) => {
      return listAuditTrail(input.limit ?? 12, input.since);
    }),
  environmentVariables: envReadProcedure
    .input(
      z.object({
        environmentId: z.string().min(1).optional(),
        serviceId: z.string().min(1).optional(),
        branch: z.string().min(1).max(255).optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireViewerTeamId(ctx.session.user.id);
      return listEnvironmentVariableInventory({
        teamId,
        environmentId: input.environmentId,
        serviceId: input.serviceId,
        branch: input.branch,
        limit: input.limit ?? 50,
        canRevealSecrets: ctx.auth.capabilities.includes("secrets:read")
      });
    }),
  projects: deployReadProcedure.input(limitInput(50)).query(async ({ ctx, input }) => {
    const teamId = await requireViewerTeamId(ctx.session.user.id);
    return listProjects(teamId, input.limit ?? 50);
  }),
  projectDetails: deployReadProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const teamId = await requireViewerTeamId(ctx.session.user.id);
      const project = await getProject(input.projectId, teamId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
      }
      return project;
    }),
  projectEnvironments: deployReadProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const teamId = await requireViewerTeamId(ctx.session.user.id);
      const project = await getProject(input.projectId, teamId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
      }
      return listEnvironments(input.projectId, teamId);
    }),
  services: protectedProcedure
    .input(
      z.object({
        environmentId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(async ({ input }) => {
      return listServices(input.environmentId, input.limit ?? 50);
    }),
  serviceDetails: protectedProcedure
    .input(z.object({ serviceId: z.string().min(1) }))
    .query(async ({ input }) => {
      const service = await getService(input.serviceId);
      if (!service) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }
      return service;
    }),
  serviceDomainState: protectedProcedure
    .input(z.object({ serviceId: z.string().min(1) }))
    .query(async ({ input }) => {
      const state = await getServiceDomainState({
        serviceId: input.serviceId
      });
      if (!state) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }
      return state;
    }),
  projectServices: deployReadProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const teamId = await requireViewerTeamId(ctx.session.user.id);
      const project = await getProject(input.projectId, teamId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
      }
      return listServicesByProject(input.projectId);
    }),
  agents: protectedProcedure.query(async () => {
    return listAgentPrincipals();
  }),
  gitProviders: protectedProcedure.query(async () => {
    return listGitProviderSummaries();
  }),
  gitInstallations: protectedProcedure
    .input(z.object({ providerId: z.string().min(1).optional() }))
    .query(async ({ input }) => {
      return listGitInstallationSummaries(input.providerId);
    }),
  containerRegistries: serverWriteProcedure.query(async () => {
    return listContainerRegistrySummaries();
  }),
  backupDestinations: protectedProcedure.input(limitInput(50)).query(async ({ input }) => {
    return listDestinations(input.limit ?? 50);
  }),
  backupDestination: protectedProcedure
    .input(z.object({ destinationId: z.string().min(1) }))
    .query(async ({ input }) => {
      const dest = await getDestination(input.destinationId);
      if (!dest) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Destination not found." });
      }
      return dest;
    }),
  backupMetrics: protectedProcedure.query(async () => {
    return listBackupMetrics();
  }),
  operationalMaintenanceReport: serverWriteProcedure.query(async () => {
    return getOperationalMaintenanceReport();
  }),
  backupDiagnosis: protectedProcedure
    .input(z.object({ runId: z.string().min(1) }))
    .query(async ({ input }) => {
      const result = await backupDiagnosis(input.runId);
      if (!result) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Backup run not found." });
      }
      return result;
    })
});

export const readRouter = t.mergeRouters(coreReadRouter, deploymentReadRouter, backupReadRouter);
