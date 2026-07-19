import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { configureServerMetricPolicy } from "../db/services/server-metric-policy";
import { serverWriteProcedure, t } from "../trpc";
import { requireActorTeamId } from "./command-admin-shared";

const threshold = z.number().int().min(0).max(100);
const policyInput = z
  .object({
    serverId: z.string().min(1).max(32),
    sampleIntervalSeconds: z.number().int().min(1).max(86_400),
    retentionDays: z.number().int().min(1).max(3_650),
    cpuWarnPercent: threshold,
    cpuHardPercent: threshold,
    memoryWarnPercent: threshold,
    memoryHardPercent: threshold,
    diskWarnPercent: threshold,
    diskHardPercent: threshold,
    dockerDiskWarnPercent: threshold,
    dockerDiskHardPercent: threshold,
    cooldownMinutes: z.number().int().min(0).max(1_440)
  })
  .superRefine((policy, ctx) => {
    for (const [label, warning, hard] of [
      ["CPU", policy.cpuWarnPercent, policy.cpuHardPercent],
      ["Memory", policy.memoryWarnPercent, policy.memoryHardPercent],
      ["Root disk", policy.diskWarnPercent, policy.diskHardPercent],
      ["Docker disk", policy.dockerDiskWarnPercent, policy.dockerDiskHardPercent]
    ] as const) {
      if (warning > 0 && hard > 0 && warning > hard) {
        ctx.addIssue({
          code: "custom",
          message: `${label} warning threshold cannot exceed its hard threshold.`
        });
      }
    }
  });

export const adminServerMetricsRouter = t.router({
  configureServerMetricPolicy: serverWriteProcedure
    .input(policyInput)
    .mutation(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const result = await configureServerMetricPolicy({ ...input, teamId });
      if (result.status === "not_found") {
        throw new TRPCError({ code: "NOT_FOUND", message: "Server not found." });
      }
      return result.policy;
    })
});
