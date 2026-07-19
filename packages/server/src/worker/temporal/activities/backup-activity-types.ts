import type { VolumeSourceKind } from "./volume-source-kind";

export interface BackupPolicyResolved {
  policyId: string;
  teamId: string;
  policyName: string;
  volumeId: string;
  volumeName: string;
  mountPath: string;
  sourceKind: VolumeSourceKind;
  serverId: string;
  serverName: string;
  serverHost: string;
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
  /** Non-secret reference; credentials are loaded only by destination activities. */
  destinationId: string;
}

export interface BackupRunResult {
  runId: string;
  artifactPath: string;
  sizeBytes: number;
  checksum?: string;
  artifactFormat?: string;
  databaseEngineVersion?: string;
  databaseImageReference?: string;
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
