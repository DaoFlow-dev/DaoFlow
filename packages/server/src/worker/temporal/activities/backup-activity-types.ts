import type { DestinationConfig } from "../../rclone-executor";

export interface BackupPolicyResolved {
  policyId: string;
  policyName: string;
  volumeId: string;
  volumeName: string;
  mountPath: string;
  serverId: string;
  serverName: string;
  retentionDays: number;
  backupType: string;
  databaseEngine?: string;
  turnOff: boolean;
  retentionDaily: number | null;
  retentionWeekly: number | null;
  retentionMonthly: number | null;
  maxBackups: number | null;
  containerName?: string;
  projectName?: string;
  environmentName?: string;
  serviceName?: string;
  databaseName?: string;
  databaseUser?: string;
  databasePassword?: string;
  destination: DestinationConfig;
}

export interface BackupRunResult {
  runId: string;
  artifactPath: string;
  sizeBytes: number;
}

export interface IntegrityCheckResult {
  verified: boolean;
  fileCount: number;
  totalBytes: number;
  error?: string;
}

export interface StorageUsageResult {
  destinationId: string;
  totalBytes: number;
  quotaBytes: number | null;
  quotaWarningPercent: number;
  usagePercent: number | null;
  overQuota: boolean;
  overWarning: boolean;
}
