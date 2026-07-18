export interface ServiceBackupVolume {
  id: string;
  volumeName: string;
  mountPath: string;
  sizeBytes: number;
  backupPolicyId: string | null;
  storageProvider: string | null;
  lastBackupAt: string | null;
  backupCoverage: string;
  restoreReadiness: string;
}

export interface ServiceBackupPolicy {
  id: string;
  name: string;
  destinationName: string | null;
  backupType: string;
  schedule: string;
  retentionDays: number;
  lastRunAt: string | null;
}

export interface ServiceBackupRun {
  id: string;
  policyId: string;
  status: string;
  artifactPath: string | null;
  bytesWritten: number | null;
  finishedAt: string | null;
}

export interface ServiceBackupRestore {
  id: string;
  mode: "restore" | "verification";
  status: string;
  targetPath: string | null;
  requestedBy: string;
  requestedAt: string;
}

export interface ServiceBackupWorkflow {
  summary: {
    totalVolumes: number;
    protectedVolumes: number;
    failedRuns: number;
    restoreRequests: number;
  };
  volumes: ServiceBackupVolume[];
  policies: ServiceBackupPolicy[];
  runs: ServiceBackupRun[];
  restores: ServiceBackupRestore[];
}

export interface BackupRestorePlan {
  isReady: boolean;
  backupRun: {
    artifactPath: string;
  };
  target: {
    path: string;
  };
  preflightChecks: Array<{
    status: "ok" | "warn";
    detail: string;
  }>;
}
