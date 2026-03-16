import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  getDeploymentRecord,
  listDeploymentInsights,
  listDeploymentLogs,
  listDeploymentRecords,
  listDeploymentRollbackPlans
} from "../db/services/deployments";
import { listApprovalQueue } from "../db/services/approvals";
import { listAuditTrail, listOperationsTimeline } from "../db/services/audit";
import {
  listBackupOverview,
  listBackupRestoreQueue,
  listPersistentVolumeInventory
} from "../db/services/backups";
import { listComposeDriftReport, listComposeReleaseCatalog } from "../db/services/compose";
import { listEnvironmentVariableInventory } from "../db/services/envvars";
import { listExecutionQueue } from "../db/services/execution";
import { listInfrastructureInventory, listServerReadiness } from "../db/services/servers";
import { listProjects, getProject, listEnvironments } from "../db/services/projects";
import { listServices, listServicesByProject, getService } from "../db/services/services";
import { listRollbackTargets } from "../db/services/execute-rollback";
import { listAgentPrincipals } from "../db/services/agents";
import { t, protectedProcedure } from "../trpc";
import { limitInput, statusLimitInput } from "../schemas";

const productPrinciples = [
  "Agent-first, human-supervised",
  "Safety before autonomy",
  "Compose-first before platform sprawl",
  "Transparent infrastructure before magic",
  "Auditability before convenience",
  "Structured output before pretty output"
] as const;

const agentApiLanes = ["read APIs", "planning APIs", "command APIs"] as const;

export const readRouter = t.router({
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
    .input(statusLimitInput(["healthy", "failed", "running", "queued"], 50))
    .query(async ({ input }) => {
      return listDeploymentRecords(input.status, input.limit ?? 20);
    }),
  composeReleaseCatalog: protectedProcedure.input(limitInput(40)).query(async ({ input }) => {
    return listComposeReleaseCatalog(input.limit ?? 24);
  }),
  composeDriftReport: protectedProcedure.input(limitInput(40)).query(async ({ input }) => {
    return listComposeDriftReport(input.limit ?? 24);
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
    .input(statusLimitInput(["pending", "dispatched", "completed", "failed"], 50))
    .query(async ({ input }) => {
      return listExecutionQueue(input.status, input.limit ?? 12);
    }),
  infrastructureInventory: protectedProcedure.query(async () => {
    return listInfrastructureInventory();
  }),
  serverReadiness: protectedProcedure.input(limitInput(24)).query(async ({ input }) => {
    return listServerReadiness(input.limit ?? 12);
  }),
  persistentVolumes: protectedProcedure.input(limitInput(24)).query(async ({ input }) => {
    return listPersistentVolumeInventory(input.limit ?? 12);
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
  backupOverview: protectedProcedure.input(limitInput(50)).query(async ({ input }) => {
    return listBackupOverview(input.limit ?? 12);
  }),
  backupRestoreQueue: protectedProcedure.input(limitInput(50)).query(async ({ input }) => {
    return listBackupRestoreQueue(input.limit ?? 12);
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
  projectServices: protectedProcedure
    .input(z.object({ projectId: z.string().min(1) }))
    .query(async ({ input }) => {
      return listServicesByProject(input.projectId);
    }),
  rollbackTargets: protectedProcedure
    .input(z.object({ serviceId: z.string().min(1) }))
    .query(async ({ input }) => {
      return listRollbackTargets(input.serviceId);
    }),
  agents: protectedProcedure.query(async () => {
    return listAgentPrincipals();
  })
});
