import { z } from "zod";

export const backupDestinationProviderSchema = z.enum([
  "s3",
  "local",
  "gdrive",
  "onedrive",
  "dropbox",
  "sftp",
  "rclone"
]);

export const volumeStatusSchema = z.enum(["active", "inactive", "paused"]);
export const policyStatusSchema = z.enum(["active", "paused"]);
export const backupTypeSchema = z.enum(["volume", "database"]);
export const databaseEngineSchema = z.enum(["postgres", "mysql", "mariadb", "mongo"]);

export const backupDestinationCreateInputSchema = z.object({
  name: z.string().min(1).max(100),
  provider: backupDestinationProviderSchema,
  accessKey: z.string().optional(),
  secretAccessKey: z.string().optional(),
  bucket: z.string().optional(),
  region: z.string().optional(),
  endpoint: z.string().optional(),
  s3Provider: z.string().optional(),
  rcloneType: z.string().optional(),
  rcloneConfig: z.string().optional(),
  rcloneRemotePath: z.string().optional(),
  oauthToken: z.string().optional(),
  localPath: z.string().optional()
});

export const backupDestinationUpdateInputSchema = backupDestinationCreateInputSchema
  .partial()
  .extend({
    id: z.string().min(1),
    name: z.string().min(1).max(100).optional()
  });

export const backupDestinationIdInputSchema = z.object({
  id: z.string().min(1)
});

export const destinationFileListInputSchema = z.object({
  id: z.string().min(1),
  path: z.string().optional()
});

export const volumeCreateInputSchema = z.object({
  name: z.string().min(1).max(100),
  serverId: z.string().min(1).max(32),
  mountPath: z.string().min(1).max(500),
  sizeBytes: z.number().int().min(0).optional(),
  driver: z.string().min(1).max(80).optional(),
  serviceId: z.string().max(32).optional(),
  status: volumeStatusSchema.optional()
});

export const volumeUpdateInputSchema = z.object({
  volumeId: z.string().min(1).max(32),
  name: z.string().min(1).max(100).optional(),
  serverId: z.string().min(1).max(32).optional(),
  mountPath: z.string().min(1).max(500).optional(),
  sizeBytes: z.number().int().min(0).optional(),
  driver: z.string().min(1).max(80).optional(),
  serviceId: z.string().max(32).optional(),
  status: volumeStatusSchema.optional()
});

export const volumeDeleteInputSchema = z.object({
  volumeId: z.string().min(1).max(32)
});

export const backupPolicyCreateInputSchema = z.object({
  name: z.string().min(1).max(100),
  volumeId: z.string().min(1).max(32),
  destinationId: z.string().max(32).optional(),
  backupType: backupTypeSchema.optional(),
  databaseEngine: databaseEngineSchema.nullish(),
  turnOff: z.boolean().optional(),
  schedule: z.string().max(60).optional(),
  retentionDays: z.number().int().min(1).max(3650).optional(),
  retentionDaily: z.number().int().min(0).max(3650).optional(),
  retentionWeekly: z.number().int().min(0).max(520).optional(),
  retentionMonthly: z.number().int().min(0).max(240).optional(),
  maxBackups: z.number().int().min(1).max(10_000).optional(),
  status: policyStatusSchema.optional()
});

export const backupPolicyUpdateInputSchema = backupPolicyCreateInputSchema.partial().extend({
  policyId: z.string().min(1).max(32),
  name: z.string().min(1).max(100).optional(),
  volumeId: z.string().min(1).max(32).optional()
});

export const backupPolicyIdInputSchema = z.object({
  policyId: z.string().min(1).max(32)
});

export const backupScheduleEnableInputSchema = z.object({
  policyId: z.string().min(1),
  schedule: z.string().min(1)
});
