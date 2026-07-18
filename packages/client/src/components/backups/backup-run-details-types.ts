import type { BackupVerificationView } from "./BackupVerificationCard";

export interface BackupRunDetailsView {
  id: string;
  policyId: string;
  policyName: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  targetType: string;
  destinationName: string;
  destinationProvider: string | null;
  destinationServerName: string;
  mountPath: string | null;
  backupType: string;
  databaseEngine: string | null;
  scheduleLabel: string | null;
  retentionCount: number | null;
  status: string;
  triggerKind: string;
  executionEngine?: "temporal" | "legacy";
  temporalWorkflowId?: string | null;
  requestedBy: string;
  artifactPath: string | null;
  bytesWritten: number | null;
  checksum: string | null;
  artifactFormat?: string | null;
  databaseEngineVersion?: string | null;
  artifactCheckedAt?: string | null;
  verifiedAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  restoreCount: number;
  latestVerification?: BackupVerificationView | null;
  logsState: "unavailable" | "empty" | "streaming" | "available";
  logEntries: Array<{
    timestamp: string;
    level: "info" | "warn" | "error";
    phase: string;
    message: string;
  }>;
}
