import { z } from "zod";
import { TRPCError } from "@trpc/server";
import { deploymentHealthStatuses, executionJobStatuses } from "@daoflow/shared";
import {
  getDeploymentRecord,
  listDeploymentInsights,
  listDeploymentLogs,
  listDeploymentRecords,
  listDeploymentRollbackPlans
} from "../db/services/deployments";
import { listApprovalQueue } from "../db/services/approvals";
import { listAuditTrail, listOperationsTimeline } from "../db/services/audit";
import { listBackupMetrics, backupDiagnosis } from "../db/services/backups";
import { listDestinations, getDestination } from "../db/services/destinations";
import { listComposeDriftReport, listComposeReleaseCatalog } from "../db/services/compose";
import { listComposePreviewReconciliation } from "../db/services/compose-preview-reconciliation";
import { listComposePreviewDeployments } from "../db/services/compose-previews";
import { listEnvironmentVariableInventory } from "../db/services/envvars";
import { listExecutionQueue } from "../db/services/execution";
import { listInfrastructureInventory, listServerReadiness } from "../db/services/servers";
import { listProjects, getProject, listEnvironments } from "../db/services/projects";
import { getServiceDomainState } from "../db/services/service-domains";
import { listServices, listServicesByProject, getService } from "../db/services/services";
import { listRollbackTargets } from "../db/services/execute-rollback";
import { listAgentPrincipals } from "../db/services/agents";
import {
  listGitInstallationSummaries,
  listGitProviderSummaries
} from "../db/services/git-providers";
import { t, protectedProcedure, deployReadProcedure } from "../trpc";
import { limitInput, statusLimitInput } from "../schemas";
import { backupReadRouter } from "./read-backups";

const productPrinciples = [
  "Agent-first, human-supervised",
  "Safety before autonomy",
  "Compose-first before platform sprawl",
  "Transparent infrastructure before magic",
  "Auditability before convenience",
  "Structured output before pretty output"
] as const;

const agentApiLanes = ["read APIs", "planning APIs", "command APIs"] as const;

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
  recentDeployments: protectedProcedure
    .input(statusLimitInput(deploymentHealthStatuses, 50))
    .query(async ({ input }) => {
      return listDeploymentRecords(input.status, input.limit ?? 20);
    }),
  composeReleaseCatalog: protectedProcedure.input(limitInput(40)).query(async ({ input }) => {
    return listComposeReleaseCatalog(input.limit ?? 24);
  }),
  composeDriftReport: protectedProcedure.input(limitInput(40)).query(async ({ input }) => {
    return listComposeDriftReport(input.limit ?? 24);
  }),
  composePreviews: deployReadProcedure
    .input(
      z.object({
        serviceId: z.string().min(1)
      })
    )
    .query(async ({ ctx, input }) => {
      return listComposePreviewDeployments({
        serviceRef: input.serviceId,
        requestedByUserId: ctx.session.user.id
      });
    }),
  composePreviewReconciliation: deployReadProcedure
    .input(
      z.object({
        serviceId: z.string().min(1)
      })
    )
    .query(async ({ ctx, input }) => {
      return listComposePreviewReconciliation({
        serviceRef: input.serviceId,
        requestedByUserId: ctx.session.user.id
      });
    }),
  approvalQueue: protectedProcedure.input(limitInput(40)).query(async ({ input }) => {
    return listApprovalQueue(input.limit ?? 24);
  }),
  deploymentDetails: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1)
      })
    )
    .query(async ({ input }) => {
      const deployment = await getDeploymentRecord(input.deploymentId);

      if (!deployment) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Deployment record not found."
        });
      }

      return deployment;
    }),
  executionQueue: protectedProcedure
    .input(statusLimitInput(executionJobStatuses, 50))
    .query(async ({ input }) => {
      return listExecutionQueue(input.status, input.limit ?? 12);
    }),
  infrastructureInventory: protectedProcedure.query(async () => {
    return listInfrastructureInventory();
  }),
  serverReadiness: protectedProcedure.input(limitInput(24)).query(async ({ input }) => {
    return listServerReadiness(input.limit ?? 12);
  }),
  deploymentInsights: protectedProcedure.input(limitInput(12)).query(async ({ input }) => {
    return listDeploymentInsights(input.limit ?? 6);
  }),
  deploymentRollbackPlans: protectedProcedure.input(limitInput(12)).query(async ({ input }) => {
    return listDeploymentRollbackPlans(input.limit ?? 6);
  }),
  auditTrail: protectedProcedure.input(limitInput(50)).query(async ({ input }) => {
    return listAuditTrail(input.limit ?? 12);
  }),
  environmentVariables: protectedProcedure
    .input(
      z.object({
        environmentId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(async ({ input }) => {
      return listEnvironmentVariableInventory(input.environmentId, input.limit ?? 50);
    }),
  deploymentLogs: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(async ({ input }) => {
      return listDeploymentLogs(input.deploymentId, input.limit ?? 18);
    }),
  operationsTimeline: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1).optional(),
        limit: z.number().int().min(1).max(50).optional()
      })
    )
    .query(async ({ input }) => {
      return listOperationsTimeline(input.deploymentId, input.limit ?? 12);
    }),
  projects: protectedProcedure.input(limitInput(50)).query(async ({ input }) => {
    return listProjects(input.limit ?? 50);
  }),
  projectDetails: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      const project = await getProject(input.projectId);
      if (!project) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Project not found." });
      }
      return project;
    }),
  projectEnvironments: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      return listEnvironments(input.projectId);
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
  projectServices: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      return listServicesByProject(input.projectId);
    }),
  rollbackTargets: deployReadProcedure
    .input(z.object({ serviceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return listRollbackTargets(input.serviceId, ctx.session.user.id);
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

export const readRouter = t.mergeRouters(coreReadRouter, backupReadRouter);
