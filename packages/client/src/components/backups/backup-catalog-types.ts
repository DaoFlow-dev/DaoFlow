export interface BackupPolicy {
  id: string;
  serviceName: string;
  environmentName: string;
  targetType: string;
  storageProvider: string;
  scheduleLabel: string | null;
  retentionCount: number;
}

export interface BackupRun {
  id: string;
  serviceName: string;
  environmentName: string;
  targetType: string;
  triggerKind: string;
  status: string;
  statusTone?: string;
  requestedBy: string;
  artifactPath: string | null;
}

export interface RestoreRequest {
  id: string;
  serviceName: string;
  environmentName: string;
  targetType: string;
  status: string;
  statusTone?: string;
  destinationServerName: string;
  restorePath: string | null;
  sourceArtifactPath: string | null;
  validationSummary: string | null;
}

export interface BackupOverviewData {
  summary: {
    totalPolicies: number;
    queuedRuns: number;
    succeededRuns: number;
    failedRuns: number;
  };
  policies: BackupPolicy[];
  runs: BackupRun[];
}

export interface BackupRestoreQueueData {
  summary: {
    totalRequests: number;
    queuedRequests: number;
    succeededRequests: number;
    failedRequests: number;
  };
  requests: RestoreRequest[];
}
