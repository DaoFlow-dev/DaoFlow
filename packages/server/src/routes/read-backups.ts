import { z } from "zod";
import { TRPCError } from "@trpc/server";
import {
  listBackupOverviewForTeam,
  listBackupRestoreQueueForTeam,
  listPersistentVolumeInventoryForTeam
} from "../db/services/backup-team-lists";
import { listServiceBackupWorkflowForTeam } from "../db/services/service-backup-workflows";
import { getBackupRunDetails } from "../db/services/backup-run-details";
import { backupReadProcedure, t, volumesReadProcedure } from "../trpc";
import { limitInput } from "../schemas";
import { assertBackupRunScope } from "./backup-scope";
import { requireActorTeamId } from "./team-scope";

export const backupReadRouter = t.router({
  backupOverview: backupReadProcedure
    .input(
      limitInput(50).extend({
        serviceId: z.string().min(1).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      if (input.serviceId) {
        const workflow = await listServiceBackupWorkflowForTeam({
          serviceId: input.serviceId,
          teamId,
          limit: input.limit ?? 12
        });
        if (!workflow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
        }

        return {
          summary: {
            totalPolicies: workflow.summary.totalPolicies,
            queuedRuns: workflow.runs.filter((run) => run.status === "queued").length,
            runningRuns: workflow.runs.filter((run) => run.status === "running").length,
            succeededRuns: workflow.summary.succeededRuns,
            failedRuns: workflow.summary.failedRuns
          },
          policies: workflow.policies,
          runs: workflow.runs
        };
      }

      return listBackupOverviewForTeam(teamId, input.limit ?? 12);
    }),
  backupRestoreQueue: backupReadProcedure
    .input(
      limitInput(50).extend({
        serviceId: z.string().min(1).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      if (input.serviceId) {
        const workflow = await listServiceBackupWorkflowForTeam({
          serviceId: input.serviceId,
          teamId,
          limit: input.limit ?? 12
        });
        if (!workflow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
        }

        return {
          summary: {
            totalRequests: workflow.summary.restoreRequests,
            queuedRequests: workflow.restores.filter((restore) => restore.status === "queued")
              .length,
            runningRequests: workflow.restores.filter((restore) => restore.status === "running")
              .length,
            succeededRequests: workflow.restores.filter((restore) => restore.status === "succeeded")
              .length,
            failedRequests: workflow.restores.filter((restore) => restore.status === "failed")
              .length
          },
          requests: workflow.restores.map((restore) => ({
            id: restore.id,
            mode: restore.mode,
            policyId: restore.policyId,
            projectName: workflow.service.projectName,
            environmentName: workflow.service.environmentName,
            serviceName: workflow.service.name,
            targetType: "volume" as const,
            requestedBy: restore.requestedBy,
            destinationServerName: restore.destinationServerName,
            sourceArtifactPath: restore.sourceArtifactPath,
            restorePath: restore.targetPath,
            verificationResult: restore.verificationResult,
            validationSummary: restore.error ?? "",
            status: restore.status,
            statusTone: restore.statusTone,
            requestedAt: restore.requestedAt,
            finishedAt: restore.finishedAt
          }))
        };
      }

      return listBackupRestoreQueueForTeam(teamId, input.limit ?? 12);
    }),
  persistentVolumes: volumesReadProcedure
    .input(
      limitInput(100).extend({
        serviceId: z.string().min(1).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      if (input.serviceId) {
        const workflow = await listServiceBackupWorkflowForTeam({
          serviceId: input.serviceId,
          teamId,
          limit: input.limit ?? 24
        });
        if (!workflow) {
          throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
        }

        return {
          summary: {
            totalVolumes: workflow.summary.totalVolumes,
            protectedVolumes: workflow.summary.protectedVolumes,
            attentionVolumes: workflow.volumes.filter(
              (volume) =>
                volume.backupCoverage !== "protected" || volume.restoreReadiness !== "verified"
            ).length,
            attachedBytes: workflow.volumes.reduce((sum, volume) => sum + volume.sizeBytes, 0)
          },
          volumes: workflow.volumes.map((volume) => ({
            ...volume,
            environmentId: "",
            environmentName: workflow.service.environmentName,
            projectId: "",
            projectName: workflow.service.projectName,
            serviceId: workflow.service.id,
            serviceName: workflow.service.name,
            targetServerName: volume.serverName
          }))
        };
      }

      return listPersistentVolumeInventoryForTeam(teamId, input.limit ?? 12);
    }),
  serviceBackupWorkflow: backupReadProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        limit: z.number().int().min(1).max(100).optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const workflow = await listServiceBackupWorkflowForTeam({
        serviceId: input.serviceId,
        teamId,
        limit: input.limit ?? 12
      });

      if (!workflow) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
      }

      return workflow;
    }),
  backupRunDetails: backupReadProcedure
    .input(
      z.object({
        runId: z.string().min(1)
      })
    )
    .query(async ({ ctx, input }) => {
      await assertBackupRunScope({
        ctx,
        backupRunId: input.runId,
        action: "backup.details.denied",
        permissionScope: "backup:read"
      });
      const run = await getBackupRunDetails(input.runId);

      if (!run) {
        throw new TRPCError({
          code: "NOT_FOUND",
          message: "Backup run not found."
        });
      }

      return run;
    })
});
