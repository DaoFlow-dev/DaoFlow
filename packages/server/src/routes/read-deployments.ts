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
import { listComposeReleaseCatalog } from "../db/services/compose";
import { listComposeDriftReport } from "../db/services/compose-drift";
import { listComposePreviewReconciliation } from "../db/services/compose-preview-reconciliation";
import { listComposePreviewDeployments } from "../db/services/compose-previews";
import { listExecutionQueue } from "../db/services/execution";
import { listRollbackTargets } from "../db/services/execute-rollback";
import { listOperationsTimeline } from "../db/services/audit";
import { resolveMemberTeamIdForUser } from "../db/services/teams";
import { protectedProcedure, deployReadProcedure, t } from "../trpc";
import { limitInput, statusLimitInput } from "../schemas";

async function requireDeploymentReadTeamId(userId: string) {
  const teamId = await resolveMemberTeamIdForUser(userId);
  if (!teamId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No team membership is available for this user."
    });
  }

  return teamId;
}

export const deploymentReadRouter = t.router({
  recentDeployments: protectedProcedure
    .input(statusLimitInput(deploymentHealthStatuses, 50))
    .query(async ({ ctx, input }) => {
      const teamId = await requireDeploymentReadTeamId(
        ctx.auth.principal.linkedUserId ?? ctx.session.user.id
      );
      return listDeploymentRecords(input.status, input.limit ?? 20, teamId);
    }),
  composeReleaseCatalog: protectedProcedure.input(limitInput(40)).query(async ({ ctx, input }) => {
    const teamId = await requireDeploymentReadTeamId(
      ctx.auth.principal.linkedUserId ?? ctx.session.user.id
    );
    return listComposeReleaseCatalog(input.limit ?? 24, teamId);
  }),
  composeDriftReport: deployReadProcedure.input(limitInput(40)).query(async ({ ctx, input }) => {
    const userId = ctx.auth.principal.linkedUserId ?? ctx.session.user.id;
    const teamId = await requireDeploymentReadTeamId(userId);
    return listComposeDriftReport({ teamId, limit: input.limit ?? 24 });
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
  deploymentDetails: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1)
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireDeploymentReadTeamId(
        ctx.auth.principal.linkedUserId ?? ctx.session.user.id
      );
      const deployment = await getDeploymentRecord(input.deploymentId, teamId);

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
    .query(async ({ ctx, input }) => {
      const teamId = await requireDeploymentReadTeamId(
        ctx.auth.principal.linkedUserId ?? ctx.session.user.id
      );
      return listExecutionQueue(input.status, input.limit ?? 12, teamId);
    }),
  deploymentInsights: protectedProcedure.input(limitInput(12)).query(async ({ ctx, input }) => {
    const teamId = await requireDeploymentReadTeamId(
      ctx.auth.principal.linkedUserId ?? ctx.session.user.id
    );
    return listDeploymentInsights(input.limit ?? 6, teamId);
  }),
  deploymentRollbackPlans: protectedProcedure
    .input(limitInput(12))
    .query(async ({ ctx, input }) => {
      const teamId = await requireDeploymentReadTeamId(
        ctx.auth.principal.linkedUserId ?? ctx.session.user.id
      );
      return listDeploymentRollbackPlans(input.limit ?? 6, teamId);
    }),
  deploymentLogs: protectedProcedure
    .input(
      z.object({
        deploymentId: z.string().min(1).optional(),
        service: z.string().min(1).max(80).optional(),
        query: z.string().trim().min(1).max(200).optional(),
        stream: z.enum(["all", "stdout", "stderr"]).optional(),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireDeploymentReadTeamId(
        ctx.auth.principal.linkedUserId ?? ctx.session.user.id
      );
      return listDeploymentLogs({
        teamId,
        deploymentId: input.deploymentId,
        serviceName: input.service,
        query: input.query,
        stream: input.stream,
        limit: input.limit ?? 18
      });
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
  rollbackTargets: deployReadProcedure
    .input(z.object({ serviceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      return listRollbackTargets(input.serviceId, ctx.session.user.id);
    })
});
