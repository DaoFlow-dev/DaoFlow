import { TRPCError } from "@trpc/server";
import { z } from "zod";
import { getServiceForTeam } from "../db/services/service-access";
import { resolveServiceRuntime } from "../db/services/service-runtime";
import {
  previewServiceRuntimeLoggingUpdate,
  readServiceRuntimeConfigFromConfig
} from "../service-runtime-config";
import { inspectServiceLogging } from "../worker/service-logging-inspection";
import { deployReadProcedure, diagnosticsReadProcedure, t } from "../trpc";
import { serviceRuntimeLoggingSchema } from "./command-admin-service-schemas";
import { serviceAccessActor } from "./service-scope";
import { requireActorTeamId } from "./team-scope";

async function getScopedService(input: {
  serviceId: string;
  teamId: string;
  ctx: Parameters<typeof serviceAccessActor>[0];
  action: string;
  permissionScope: "deploy:read" | "diagnostics:read";
}) {
  const service = await getServiceForTeam({
    serviceId: input.serviceId,
    teamId: input.teamId,
    actor: serviceAccessActor(input.ctx),
    action: input.action,
    permissionScope: input.permissionScope
  });
  if (!service) {
    throw new TRPCError({ code: "NOT_FOUND", message: "Service not found." });
  }
  return service;
}

export const serviceLoggingReadRouter = t.router({
  serviceLoggingState: diagnosticsReadProcedure
    .input(z.object({ serviceId: z.string().min(1) }))
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const service = await getScopedService({
        serviceId: input.serviceId,
        teamId,
        ctx,
        action: "service.logging-state.denied",
        permissionScope: "diagnostics:read"
      });
      const desired = readServiceRuntimeConfigFromConfig(service.config)?.logging ?? null;
      const serviceSummary = { id: service.id, name: service.name };
      const inspectedAt = new Date().toISOString();
      const runtimeResult = await resolveServiceRuntime(input.serviceId, { teamId });

      if (runtimeResult.status === "no_runtime") {
        return {
          service: serviceSummary,
          desired,
          status: "not-deployed" as const,
          reason: "No successful deployment exists for this service yet.",
          inspectedAt,
          containers: []
        };
      }
      if (runtimeResult.status !== "ok") {
        return {
          service: serviceSummary,
          desired,
          status: "unavailable" as const,
          reason: "The deployed service runtime is not available for inspection.",
          inspectedAt,
          containers: []
        };
      }

      const inspection = await inspectServiceLogging({
        runtime: runtimeResult.runtime,
        desired
      });
      return { service: serviceSummary, desired, inspectedAt, ...inspection };
    }),

  previewServiceLoggingConfig: deployReadProcedure
    .input(
      z.object({
        serviceId: z.string().min(1),
        logging: serviceRuntimeLoggingSchema.nullable()
      })
    )
    .query(async ({ ctx, input }) => {
      const teamId = await requireActorTeamId(ctx.session.user.id);
      const service = await getScopedService({
        serviceId: input.serviceId,
        teamId,
        ctx,
        action: "service.logging-preview.denied",
        permissionScope: "deploy:read"
      });

      if (service.sourceType !== "compose" || !service.composeServiceName?.trim()) {
        throw new TRPCError({
          code: "BAD_REQUEST",
          message:
            "Managed logging preview requires a compose service with a concrete compose name."
        });
      }

      return previewServiceRuntimeLoggingUpdate({
        config: service.config,
        composeServiceName: service.composeServiceName,
        logging: input.logging
          ? {
              managed: true,
              driver: "json-file",
              maxSizeMb: input.logging.maxSizeMb,
              maxFiles: input.logging.maxFiles,
              allowSourceOverride: input.logging.allowSourceOverride
            }
          : null
      });
    })
});
