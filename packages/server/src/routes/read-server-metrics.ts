import { TRPCError } from "@trpc/server";
import { auditSinceWindowError, auditSinceWindowPattern } from "@daoflow/shared";
import { z } from "zod";
import {
  getLatestServerMetrics,
  getServerMetricMonitoring,
  listServerMetricsHistory,
  listTeamServersLatestMetrics
} from "../db/services/server-metrics";
import { getServerForTeam } from "../db/services/team-scoped-servers";
import { serverReadProcedure, t } from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";
import { serializeServerMetricMonitoring } from "./server-metric-route-model";

export const serverMetricsReadRouter = t.router({
  serverMetrics: serverReadProcedure
    .input(
      z.object({
        serverId: z.string().min(1).max(32),
        limit: z.number().int().min(1).max(500).optional(),
        since: z
          .string()
          .regex(auditSinceWindowPattern, { message: auditSinceWindowError })
          .optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const server = await getServerForTeam(input.serverId, teamId);
      if (!server) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Server not found." });
      }
      if (input.limit || input.since) {
        return listServerMetricsHistory(input.serverId, input.limit ?? 60, input.since);
      }
      const latest = await getLatestServerMetrics(input.serverId);
      return latest ? [latest] : [];
    }),

  serverMetricsOverview: serverReadProcedure.query(async ({ ctx }) => {
    const teamId = await requireActorTeamId(ctx.session.user.id);
    return listTeamServersLatestMetrics(teamId);
  }),

  serverMetricMonitoring: serverReadProcedure
    .input(
      z.object({
        serverId: z.string().min(1).max(32),
        limit: z.number().int().min(1).max(500).optional(),
        since: z
          .string()
          .regex(auditSinceWindowPattern, { message: auditSinceWindowError })
          .optional()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const server = await getServerForTeam(input.serverId, teamId);
      if (!server) {
        throw new TRPCError({ code: "NOT_FOUND", message: "Server not found." });
      }

      const report = await getServerMetricMonitoring(
        input.serverId,
        input.limit ?? 60,
        input.since
      );
      return serializeServerMetricMonitoring(report);
    })
});
