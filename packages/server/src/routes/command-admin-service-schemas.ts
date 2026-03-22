import { z } from "zod";

const composeReadinessProbeBaseSchema = {
  port: z.number().int().min(1).max(65535),
  timeoutSeconds: z.number().int().min(1).max(300).optional(),
  intervalSeconds: z.number().int().min(1).max(30).optional()
} as const;

export const composeReadinessProbeSchema = z.union([
  z.object({
    type: z.literal("http"),
    target: z.literal("published-port"),
    ...composeReadinessProbeBaseSchema,
    path: z.string().min(1).max(255),
    host: z.string().min(1).max(255).optional(),
    scheme: z.enum(["http", "https"]).optional(),
    successStatusCodes: z.array(z.number().int().min(100).max(599)).max(20).optional()
  }),
  z.object({
    type: z.literal("http"),
    target: z.literal("internal-network"),
    ...composeReadinessProbeBaseSchema,
    path: z.string().min(1).max(255),
    scheme: z.enum(["http", "https"]).optional(),
    successStatusCodes: z.array(z.number().int().min(100).max(599)).max(20).optional()
  }),
  z.object({
    type: z.literal("tcp"),
    target: z.literal("published-port"),
    ...composeReadinessProbeBaseSchema,
    host: z.string().min(1).max(255).optional()
  }),
  z.object({
    type: z.literal("tcp"),
    target: z.literal("internal-network"),
    ...composeReadinessProbeBaseSchema
  })
]);

export const composePreviewConfigSchema = z.object({
  enabled: z.boolean().optional(),
  mode: z.enum(["branch", "pull-request", "any"]).optional(),
  domainTemplate: z.string().min(1).max(255).optional(),
  staleAfterHours: z
    .number()
    .int()
    .min(1)
    .max(24 * 30)
    .optional()
});

export const serviceRuntimeVolumeSchema = z.object({
  source: z.string().min(1).max(500),
  target: z.string().min(1).max(500),
  mode: z.enum(["rw", "ro"]).default("rw")
});

export const serviceRuntimeRestartPolicySchema = z.object({
  name: z.enum(["always", "unless-stopped", "on-failure", "no"]),
  maxRetries: z.number().int().min(1).max(100).nullable().optional()
});

export const serviceRuntimeHealthCheckSchema = z.object({
  command: z.string().min(1).max(2_000),
  intervalSeconds: z.number().int().min(1).max(3_600),
  timeoutSeconds: z.number().int().min(1).max(3_600),
  retries: z.number().int().min(1).max(100),
  startPeriodSeconds: z.number().int().min(1).max(3_600)
});

export const serviceRuntimeResourcesSchema = z.object({
  cpuLimitCores: z.number().positive().max(256).nullable().optional(),
  cpuReservationCores: z.number().positive().max(256).nullable().optional(),
  memoryLimitMb: z
    .number()
    .int()
    .min(1)
    .max(1024 * 1024)
    .nullable()
    .optional(),
  memoryReservationMb: z
    .number()
    .int()
    .min(1)
    .max(1024 * 1024)
    .nullable()
    .optional()
});

export const servicePortMappingSchema = z.object({
  id: z.string().min(1).max(64).optional(),
  hostPort: z.number().int().min(1).max(65535),
  containerPort: z.number().int().min(1).max(65535),
  protocol: z.enum(["tcp", "udp"]).default("tcp")
});
