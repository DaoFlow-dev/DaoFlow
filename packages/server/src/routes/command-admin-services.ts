import { TRPCError } from "@trpc/server";
import { z } from "zod";
import {
  addServiceDomain,
  removeServiceDomain,
  setPrimaryServiceDomain,
  updateServicePortMappings
} from "../db/services/service-domains";
import { updateServiceRuntimeConfig } from "../db/services/service-runtime-config";
import { createService, deleteService, updateService } from "../db/services/services";
import { adminProcedure, getActorContext, serviceUpdateProcedure, t } from "../trpc";
import {
  composePreviewConfigSchema,
  composeReadinessProbeSchema,
  servicePortMappingSchema,
  serviceRuntimeHealthCheckSchema,
  serviceRuntimeResourcesSchema,
  serviceRuntimeRestartPolicySchema,
  serviceRuntimeVolumeSchema
} from "./command-admin-service-schemas";

export const adminServiceRouter = t.router({
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
          message: "A service with this name already exists in the environment."
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
    })
});
