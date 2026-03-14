import { z } from "zod";
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
import { t, protectedProcedure } from "../trpc";
import { TRPCError } from "@trpc/server";

const productPrinciples = [
  "Safety before autonomy",
  "Compose-first before platform sprawl",
  "Transparent infrastructure before magic",
  "Auditability before convenience"
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
    thesis: "A Docker-first deployment control plane for bare metal and VPS environments.",
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
    .input(
      z.object({
        status: z.enum(["healthy", "failed", "running", "queued"]).optional(),
        limit: z.number().int().min(1).max(50).optional()
      })
    )
    .query(async ({ input }) => {
      return listDeploymentRecords(input.status, input.limit ?? 20);
    }),
  composeReleaseCatalog: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(40).optional()
      })
    )
    .query(async ({ input }) => {
      return listComposeReleaseCatalog(input.limit ?? 24);
    }),
  composeDriftReport: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(40).optional()
      })
    )
    .query(async ({ input }) => {
      return listComposeDriftReport(input.limit ?? 24);
    }),
  approvalQueue: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(40).optional()
      })
    )
    .query(async ({ input }) => {
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
    .input(
      z.object({
        status: z.enum(["pending", "dispatched", "completed", "failed"]).optional(),
        limit: z.number().int().min(1).max(50).optional()
      })
    )
    .query(async ({ input }) => {
      return listExecutionQueue(input.status, input.limit ?? 12);
    }),
  infrastructureInventory: protectedProcedure.query(async () => {
    return listInfrastructureInventory();
  }),
  serverReadiness: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(24).optional()
      })
    )
    .query(async ({ input }) => {
      return listServerReadiness(input.limit ?? 12);
    }),
  persistentVolumes: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(24).optional()
      })
    )
    .query(async ({ input }) => {
      return listPersistentVolumeInventory(input.limit ?? 12);
    }),
  deploymentInsights: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(12).optional()
      })
    )
    .query(async ({ input }) => {
      return listDeploymentInsights(input.limit ?? 6);
    }),
  deploymentRollbackPlans: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(12).optional()
      })
    )
    .query(async ({ input }) => {
      return listDeploymentRollbackPlans(input.limit ?? 6);
    }),
  auditTrail: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).optional()
      })
    )
    .query(async ({ input }) => {
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
  backupOverview: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).optional()
      })
    )
    .query(async ({ input }) => {
      return listBackupOverview(input.limit ?? 12);
    }),
  backupRestoreQueue: protectedProcedure
    .input(
      z.object({
        limit: z.number().int().min(1).max(50).optional()
      })
    )
    .query(async ({ input }) => {
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
    })
});
