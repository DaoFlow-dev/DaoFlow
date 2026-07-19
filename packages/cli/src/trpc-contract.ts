import type { AnyRouter } from "@trpc/server";
import type { ManagedDatabaseKind, SwarmTopologySnapshot } from "@daoflow/shared";
import type { ComposeDeploymentPlanPreview } from "./compose-deployment-plan-output";
import type { DeploymentPlanPreview } from "./deployment-plan-output";

type ProcedureArgs<TInput> = [TInput] extends [void] ? [] | [TInput?] : [TInput];

type QueryProcedure<TOutput, TInput = void> = {
  query(...args: ProcedureArgs<TInput>): Promise<TOutput>;
};

type MutationProcedure<TInput, TOutput> = {
  mutate(...args: ProcedureArgs<TInput>): Promise<TOutput>;
};

export type DaoFlowRouterBase = AnyRouter;

export interface ViewerOutput {
  principal: {
    id: string;
    email: string;
    name: string | null;
    type: "user" | "service" | "agent";
    linkedUserId: string | null;
  };
  authz: {
    authMethod: "session" | "api-token";
    stack: string;
    intent: string;
    role: string;
    capabilities: string[];
    token: {
      id: string;
      name: string;
      prefix: string;
      expiresAt: string | null;
      scopes: string[];
    } | null;
  };
  session: {
    id: string;
    expiresAt: string;
  } | null;
}

export interface HealthOutput {
  status: string;
  service: string;
  timestamp: string;
}

export interface ServerReadinessOutput {
  summary: {
    totalServers: number;
    readyServers: number;
    attentionServers: number;
    blockedServers: number;
    pollIntervalMs: number;
    averageLatencyMs: number | null;
  };
  checks: Array<{
    serverId: string;
    serverName: string;
    serverHost: string;
    targetKind: string;
    swarmTopology: SwarmTopologySnapshot | null;
    serverStatus: string;
    readinessStatus: string;
    statusTone: string;
    sshPort: number;
    sshReachable: boolean;
    dockerReachable: boolean;
    composeReachable: boolean;
    dockerVersion: string | null;
    composeVersion: string | null;
    latencyMs: number | null;
    checkedAt: string;
    issues: string[];
    recommendedActions: string[];
  }>;
}

export interface ServerOperationRecord {
  id: string;
  serverId: string;
  kind: string;
  status: string;
  dryRun: boolean;
  requestedByUserId: string | null;
  requestedByEmail: string | null;
  requestedByRole: string | null;
  permissionScope: string | null;
  summary: string | null;
  result: unknown;
  error: string | null;
  startedAt: string | null;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ServerOperationsHubOutput {
  server: {
    id: string;
    name: string;
    host: string;
    kind: string;
    status: string;
    swarmTopology: SwarmTopologySnapshot | null;
  };
  latestResource: Record<string, unknown> | null;
  operations: ServerOperationRecord[];
}

export interface ServerOperationMutationOutput {
  status: string;
  operation?: ServerOperationRecord;
  result?: unknown;
  message?: string;
}

export interface AuditTrailOutput {
  summary: {
    totalEntries: number;
    deploymentActions: number;
    executionActions: number;
    backupActions: number;
    humanEntries: number;
  };
  entries: Array<{
    id: string;
    actorType: string;
    actorId: string;
    actorEmail: string | null;
    actorRole: string | null;
    organizationId: string | null;
    targetResource: string;
    action: string;
    inputSummary: string | null;
    permissionScope: string | null;
    outcome: string;
    metadata: Record<string, unknown> | null;
    createdAt: string;
    actorLabel: string;
    resourceType: string;
    resourceId: string;
    resourceLabel: string;
    statusTone: string;
    detail: string;
  }>;
}

export interface AccessLogsOutput {
  limit: number;
  cursor: string | null;
  nextCursor: string | null;
  filters: {
    status: string | null;
    method: string | null;
    path: string | null;
    actorType: string | null;
    tokenId: string | null;
    requestId: string | null;
    since: string | null;
    search: string | null;
    minDurationMs: number | null;
  };
  summary: {
    totalEntries: number;
    failedAuth: number;
    deniedScopes: number;
    webhookRequests: number;
    apiTokenRequests: number;
    slowRequests: number;
    errorResponses: number;
  };
  retentionDays: number;
  entries: Array<{
    id: string;
    requestId: string;
    method: string;
    path: string;
    category: string;
    statusCode: number;
    outcome: string;
    durationMs: number;
    authMethod: string | null;
    actorType: string | null;
    actorId: string | null;
    actorEmail: string | null;
    actorRole: string | null;
    tokenId: string | null;
    tokenName: string | null;
    tokenPrefix: string | null;
    requiredScopes: string[];
    grantedScopes: string[];
    sourceIp: string | null;
    userAgent: string | null;
    errorCategory: string | null;
    metadata: Record<string, unknown> | null;
    createdAt: string;
  }>;
}

export interface ApprovalQueueRequestOutput {
  id: string;
  actionType: "compose-release" | "backup-restore";
  targetResource: string;
  reason: string;
  status: string;
  requestedByUserId: string;
  requestedByEmail: string | null;
  requestedByRole: string | null;
  resolvedByUserId: string | null;
  resolvedByEmail: string | null;
  inputSummary: Record<string, unknown> | null;
  createdAt: string;
  resolvedAt: string | null;
  requestedBy: string;
  resourceLabel: string;
  riskLevel: "medium" | "elevated" | "critical";
  statusTone: "healthy" | "failed" | "running";
  commandSummary: string;
  requestedAt: string;
  expiresAt: string;
  decidedBy: string | null;
  decidedAt: string | null;
  recommendedChecks: string[];
}

export interface ApprovalQueueOutput {
  summary: {
    totalRequests: number;
    pendingRequests: number;
    approvedRequests: number;
    rejectedRequests: number;
    criticalRequests: number;
  };
  requests: ApprovalQueueRequestOutput[];
}

export interface OperationalMaintenanceReportOutput {
  generatedAt: string;
  defaults: Record<string, number>;
  current: {
    stalledDeployments: { eligibleCount: number; items: unknown[] };
    stalePreviews: { previewEnabledServices: number; eligibleCount: number; items: unknown[] };
    expiredCliAuthRequests: { eligibleCount: number };
    retainedArtifacts: {
      eligibleCount: number;
      retainedArtifacts: number;
      incompleteUploads: number;
      items: unknown[];
    };
    requestAccessLogs: { eligibleCount: number };
  };
  latestRun: {
    action: string;
    actorEmail: string | null;
    actorId: string;
    actorRole: string | null;
    outcome: string;
    summary: string;
    createdAt: string;
    metadata: unknown;
  } | null;
}

export interface OperationalMaintenanceRunOutput {
  generatedAt: string;
  dryRun: boolean;
  trigger: "manual" | "monitor";
  stalledDeployments: { eligibleCount: number; failedCount: number };
  stalePreviews: {
    previewEnabledServices: number;
    eligibleCount: number;
    queuedCount: number;
    queuedDeployments: Array<{ previewKey: string; deploymentId: string }>;
    failures: Array<{ previewKey: string; message: string }>;
  };
  expiredCliAuthRequests: { eligibleCount: number; deletedCount: number };
  retainedArtifacts: {
    eligibleCount: number;
    prunedCount: number;
    prunedRetainedArtifacts: number;
    prunedIncompleteUploads: number;
  };
  requestAccessLogs: { eligibleCount: number; prunedCount: number };
  summary: string;
}

export interface RouterOutputs {
  viewer: ViewerOutput;
  health: HealthOutput;
  serverReadiness: ServerReadinessOutput;
  serverOperationsHub: ServerOperationsHubOutput;
  auditTrail: AuditTrailOutput;
  accessLogs: AccessLogsOutput;
  approvalQueue: ApprovalQueueOutput;
  operationalMaintenanceReport: OperationalMaintenanceReportOutput;
}

export interface ComposeReleaseCatalogOutput {
  summary: {
    totalServices: number;
    statefulServices: number;
    healthyEnvironments: number;
    uniqueNetworks: number;
  };
  services: Array<{
    id: string;
    environmentId: string;
    environmentName: string;
    projectName: string;
    targetServerId: string;
    targetServerName: string;
    serviceName: string;
    composeFilePath: string;
    networkName: string;
    imageReference: string;
    imageTag: string;
    replicaCount: number;
    exposedPorts: string[];
    dependencies: string[];
    volumeMounts: string[];
    healthcheckPath: string | null;
    releaseTrack: string;
    status: string;
    createdAt: string;
  }>;
}

export interface BackupOverviewOutput {
  summary: {
    totalPolicies: number;
    queuedRuns: number;
    runningRuns: number;
    succeededRuns: number;
    failedRuns: number;
  };
  policies: Array<{
    id: string;
    name: string;
    volumeId: string;
    destinationId: string | null;
    projectName: string;
    environmentName: string;
    serviceName: string;
    targetType: "volume" | "database";
    storageProvider: string;
    backupType: "volume" | "database";
    databaseEngine: "postgres" | "mysql" | "mariadb" | "mongo" | null;
    turnOff: boolean;
    scheduleLabel: string;
    schedule: string | null;
    retentionCount: number;
    retentionDays: number;
    retentionDaily: number | null;
    retentionWeekly: number | null;
    retentionMonthly: number | null;
    maxBackups: number | null;
    status: string;
    nextRunAt: string | null;
    lastRunAt: string | null;
    executionEngine: "legacy" | "temporal";
    temporalWorkflowId?: string | null;
    temporalWorkflowStatus?: string | null;
  }>;
  runs: Array<{
    id: string;
    policyId: string;
    projectName: string;
    environmentName: string;
    serviceName: string;
    targetType: "volume" | "database";
    status: string;
    triggerKind: "manual" | "scheduled";
    requestedBy: string;
    artifactPath: string | null;
    bytesWritten: number | null;
    startedAt: string;
    finishedAt: string | null;
  }>;
}

export interface PersistentVolumeRegistryOutput {
  summary: {
    totalVolumes: number;
    protectedVolumes: number;
    attentionVolumes: number;
    attachedBytes: number;
  };
  volumes: Array<{
    id: string;
    serverId: string;
    environmentId: string;
    environmentName: string;
    projectId: string;
    projectName: string;
    serviceId: string | null;
    serviceName: string;
    targetServerName: string;
    volumeName: string;
    mountPath: string;
    driver: string;
    sizeBytes: number;
    status: string;
    backupPolicyId: string | null;
    storageProvider: string | null;
    lastBackupAt: string | null;
    lastRestoreTestAt: string | null;
    backupCoverage: string;
    restoreReadiness: string;
    statusTone: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

export type BackupProvider = "s3" | "local" | "gdrive" | "onedrive" | "dropbox" | "sftp" | "rclone";

export interface BackupDestinationOutput {
  id: string;
  name: string;
  provider: BackupProvider;
  accessKey: string | null;
  bucket: string | null;
  region: string | null;
  endpoint: string | null;
  s3Provider: string | null;
  rcloneType: string | null;
  rcloneRemotePath: string | null;
  localPath: string | null;
  lastTestedAt: string | null;
  lastTestResult: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface QueueRestoreOutput {
  id: string;
  backupRunId: string;
  mode: "restore" | "verification";
  workflowId: string;
  status: string;
  targetPath: string | null;
  verificationResult: Record<string, unknown> | null;
  triggeredByUserId: string | null;
  startedAt: Date | null;
  createdAt: Date;
  completedAt: Date | null;
}

export interface VolumeMutationOutput {
  id: string;
  name: string;
  serverId: string;
  serverName: string;
  mountPath: string;
  sizeBytes: number;
  driver: string;
  serviceId: string | null;
  serviceName: string | null;
  environmentId: string | null;
  environmentName: string | null;
  projectId: string | null;
  projectName: string | null;
  status: string;
  backupPolicyId: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface BackupPolicyMutationOutput {
  id: string;
  name: string;
  volumeId: string;
  volumeName: string;
  destinationId: string | null;
  destinationName: string | null;
  backupType: "volume" | "database";
  databaseEngine: "postgres" | "mysql" | "mariadb" | "mongo" | null;
  turnOff: boolean;
  schedule: string | null;
  retentionDays: number;
  retentionDaily: number | null;
  retentionWeekly: number | null;
  retentionMonthly: number | null;
  maxBackups: number | null;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface BackupRestorePlanOutput {
  isReady: boolean;
  backupRun: {
    id: string;
    policyId: string;
    policyName: string;
    projectName: string;
    environmentName: string;
    serviceName: string;
    artifactPath: string;
    checksum: string | null;
    verifiedAt: string | null;
    restoreCount: number;
  };
  target: {
    destinationServerName: string;
    path: string;
    backupType: string;
    databaseEngine: string | null;
  };
  preflightChecks: Array<{
    status: "ok" | "warn" | "fail";
    detail: string;
  }>;
  steps: string[];
  executeCommand: string;
  approvalRequest: {
    procedure: "requestApproval";
    requiredScope: "approvals:create";
    input: {
      actionType: "backup-restore";
      backupRunId: string;
      reason: string;
    };
  };
}

export interface ControlPlaneRecoveryDestinationSummary {
  id: string;
  name: string;
  provider?: string | null;
  bucket?: string | null;
  region?: string | null;
  endpoint?: string | null;
  [key: string]: unknown;
}

export interface ControlPlaneRecoveryCheckOutput {
  status: string;
  detail: string;
  [key: string]: unknown;
}

export interface ControlPlaneRecoveryVerificationOutput {
  success?: boolean;
  status?: string;
  completedAt?: string | null;
  error?: string | null;
  checks?: Record<string, ControlPlaneRecoveryCheckOutput>;
  [key: string]: unknown;
}

export interface ControlPlaneRecoveryManifestOutput {
  formatVersion?: number;
  bundleId?: string;
  appVersion?: string;
  schemaVersion?: string;
  createdAt?: string;
  database?: {
    engine?: string;
    version?: string;
    dumpFormat?: string;
    sha256?: string;
    [key: string]: unknown;
  };
  migrations?: {
    count?: number;
    latestHash?: string | null;
    applied?: Array<{ hash: string; createdAt: number }>;
    [key: string]: unknown;
  };
  compatibility?: Record<string, unknown>;
  requiredExternalSecrets?: string[];
  recoveryKey?: {
    fingerprint?: string;
    rotatedAt?: string | null;
    [key: string]: unknown;
  };
  sanitization?: { clearedFields?: string[]; [key: string]: unknown };
  objects?: Record<string, string>;
  [key: string]: unknown;
}

export interface ControlPlaneRecoveryBundleOutput {
  id: string;
  status: string;
  appVersion?: string;
  schemaVersion?: string;
  keyFingerprint?: string | null;
  keyRotatedAt?: string | null;
  destinationId?: string;
  destination?: ControlPlaneRecoveryDestinationSummary | null;
  destinationSummary?: ControlPlaneRecoveryDestinationSummary | null;
  objectPrefix?: string;
  bundleObjectPath?: string;
  manifestObjectPath?: string;
  latestManifestObjectPath?: string;
  objectPaths?: Record<string, string>;
  bundleChecksum?: string | null;
  databaseChecksum?: string | null;
  checksums?: Record<string, string | null>;
  sizeBytes?: string | number | null;
  manifest?: ControlPlaneRecoveryManifestOutput | null;
  verification?: ControlPlaneRecoveryVerificationOutput | null;
  verificationResult?: ControlPlaneRecoveryVerificationOutput | null;
  error?: string | null;
  createdAt?: string;
  updatedAt?: string;
  startedAt?: string | null;
  completedAt?: string | null;
  [key: string]: unknown;
}

export interface ControlPlaneRecoveryPlanOutput {
  isReady: boolean;
  status?: string;
  destinationId?: string;
  destination?: ControlPlaneRecoveryDestinationSummary | null;
  destinationSummary?: ControlPlaneRecoveryDestinationSummary | null;
  appVersion?: string;
  schemaVersion?: string;
  keyFingerprint?: string | null;
  keyRotatedAt?: string | null;
  checks?: ControlPlaneRecoveryCheckOutput[];
  preflightChecks?: ControlPlaneRecoveryCheckOutput[];
  compatibility?: Record<string, unknown>;
  requiredExternalSecrets?: string[];
  objectPaths?: Record<string, string>;
  verification?: ControlPlaneRecoveryVerificationOutput | null;
  failureNextSteps?: string[];
  nextSteps?: string[];
  error?: string | null;
  [key: string]: unknown;
}

export interface ControlPlaneRecoveryBundlesOutput {
  bundles: ControlPlaneRecoveryBundleOutput[];
  limit?: number;
  [key: string]: unknown;
}

export type ControlPlaneRecoveryBundlesResult =
  ControlPlaneRecoveryBundlesOutput | ControlPlaneRecoveryBundleOutput[];

export interface ControlPlaneRecoveryBundleMetadataOutput {
  bundleId: string;
  destinationId?: string;
  destination?: ControlPlaneRecoveryDestinationSummary | null;
  appVersion?: string;
  schemaVersion?: string;
  keyFingerprint?: string | null;
  keyRotatedAt?: string | null;
  objectPaths?: Record<string, string>;
  checksums?: Record<string, string | null>;
  manifest?: ControlPlaneRecoveryManifestOutput | null;
  requiredExternalSecrets?: string[];
  verification?: ControlPlaneRecoveryVerificationOutput | null;
  [key: string]: unknown;
}

export interface BackupRunDetailsOutput {
  id: string;
  policyId: string;
  policyName: string;
  projectName: string;
  environmentName: string;
  serviceName: string;
  targetType: "volume" | "database";
  destinationName: string;
  destinationProvider: BackupProvider | null;
  destinationServerName: string;
  mountPath: string | null;
  backupType: "volume" | "database";
  databaseEngine: "postgres" | "mysql" | "mariadb" | "mongo" | null;
  scheduleLabel: string | null;
  retentionCount: number | null;
  status: string;
  statusTone: string;
  triggerKind: "manual" | "scheduled";
  executionEngine: "legacy" | "temporal";
  temporalWorkflowId: string | null;
  requestedBy: string;
  artifactPath: string | null;
  bytesWritten: number | null;
  checksum: string | null;
  artifactFormat: string | null;
  databaseEngineVersion: string | null;
  artifactCheckedAt: string | null;
  verifiedAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  restoreCount: number;
  latestVerification: {
    id: string;
    status: string;
    requestedAt: string;
    completedAt: string | null;
    result: Record<string, unknown> | null;
    error: string | null;
  } | null;
  logsState: "unavailable" | "empty" | "streaming" | "available";
  logEntries: Array<{
    timestamp: string;
    level: string;
    phase: string;
    message: string;
  }>;
}

export interface RegisterServerOutput {
  id: string;
  name: string;
  host: string;
  region: string | null;
  sshPort: number;
  sshUser: string | null;
  sshKeyId: string | null;
  kind: string;
  status: string;
  dockerVersion: string | null;
  composeVersion: string | null;
  metadata?: {
    managedTraefikProxy?: unknown;
    readinessCheck?: {
      readinessStatus?: string;
      sshReachable?: boolean;
      dockerReachable?: boolean;
      composeReachable?: boolean;
      latencyMs?: number | null;
      checkedAt?: string;
      issues?: string[];
      recommendedActions?: string[];
    };
  };
  readiness?: {
    readinessStatus: string;
    sshReachable: boolean;
    dockerReachable: boolean;
    composeReachable: boolean;
    latencyMs: number | null;
    checkedAt: string | null;
    issues: string[];
    recommendedActions: string[];
  };
}

export interface ServiceDomainStateOutput {
  serviceId: string;
  serviceName: string;
  domains: Array<{
    id: string;
    hostname: string;
    routingMode: "observed" | "managed-traefik";
    targetPort: number | null;
  }>;
}

export interface BackupRunOutput {
  id: string;
  policyId: string;
  status: string;
  triggeredByUserId: string | null;
  artifactPath: string | null;
  sizeBytes: string | number | null;
  startedAt: Date | null;
  completedAt: Date | null;
  createdAt: Date;
}

export interface EnableBackupScheduleOutput {
  policyId: string;
  schedule: string;
  workflowId: string;
}

export interface EnvironmentVariablesOutput {
  summary: {
    totalVariables: number;
    secretVariables: number;
    runtimeVariables: number;
    buildVariables: number;
  };
  variables: Array<{
    id: string;
    environmentId: string;
    environmentName: string;
    projectName: string;
    key: string;
    displayValue: string;
    isSecret: boolean;
    category: "runtime" | "build";
    branchPattern: string | null;
    source: string;
    secretRef: string | null;
    updatedByEmail: string;
    updatedAt: string;
  }>;
}

export interface UpsertEnvironmentVariableOutput {
  key: string;
  environmentId: string;
  environmentName: string;
  category: "runtime" | "build";
  status: "created" | "updated";
}

export interface DeleteEnvironmentVariableOutput {
  key: string;
  environmentId: string;
  environmentName: string;
  status: "deleted";
}

export interface ResolveEnvironmentSecretsOutput {
  ok: true;
  environmentId: string;
  resolved: number;
  unresolved: number;
  variables: Array<{
    key: string;
    secretRef: string;
    providerName: string;
    source: string;
    status: "resolved" | "unresolved";
    maskedValue: string | null;
    error: string | null;
  }>;
}

export interface RollbackTarget {
  deploymentId: string;
  serviceName: string;
  sourceType: string;
  commitSha: string | null;
  imageTag: string | null;
  concludedAt: string | null;
  status: string;
}

export interface RollbackPlanOutput {
  isReady: boolean;
  service: {
    id: string;
    name: string;
    projectId: string;
    projectName: string;
    environmentId: string;
    environmentName: string;
  };
  currentDeployment: {
    id: string;
    status: string;
    statusLabel: string;
    statusTone: string;
    imageTag: string | null;
    commitSha: string | null;
    createdAt: string;
    finishedAt: string | null;
  } | null;
  targetDeployment: {
    id: string;
    imageTag: string | null;
    commitSha: string | null;
    concludedAt: string | null;
  } | null;
  availableTargets: RollbackTarget[];
  preflightChecks: Array<{
    status: "ok" | "warn" | "fail";
    detail: string;
  }>;
  steps: string[];
  executeCommand: string;
}

export interface RollbackExecutionOutput {
  id: string;
  serviceName: string;
}

export interface DeploymentLogsOutput {
  summary: {
    totalLines: number;
    stderrLines: number;
    deploymentCount: number;
  };
  lines: Array<{
    id: string;
    deploymentId: string;
    message: string;
    stream: "stdout" | "stderr";
    lineNumber: number;
    createdAt: string;
    projectName: string;
    environmentName: string;
    serviceName: string;
  }>;
}

export interface ComposePreviewsOutput {
  service: {
    id: string;
    name: string;
    environmentId: string;
    projectId: string;
  };
  previews: Array<{
    key: string;
    target: "branch" | "pull-request";
    branch: string;
    pullRequestNumber: number | null;
    envBranch: string;
    stackName: string;
    primaryDomain: string | null;
    status?: string;
    cleanupStatus?: string;
    createdAt?: string;
    updatedAt?: string;
    lastSeenAt?: string;
    cleanupRequestedAt?: string | null;
    cleanupCompletedAt?: string | null;
    latestDeploymentId: string;
    latestAction: "deploy" | "destroy";
    latestStatus: string;
    latestStatusLabel: string;
    latestStatusTone: "healthy" | "running" | "failed" | "queued";
    lastRequestedAt: string;
    lastFinishedAt: string | null;
    isActive: boolean;
  }>;
}

export interface ProjectListItem {
  id: string;
  slug: string | null;
  teamId: string;
  name: string;
  description: string | null;
  repoFullName: string | null;
  repoUrl: string | null;
  sourceType: string;
  status: string;
  statusTone: string;
  defaultBranch: string | null;
  composePath: string | null;
  autoDeploy: boolean;
  autoDeployBranch: string | null;
  createdByUserId: string | null;
  config: unknown;
  composeFiles: string[];
  composeProfiles: string[];
  environmentCount: number;
  serviceCount: number;
  sourceReadiness: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectEnvironmentItem {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  status: string;
  statusTone: string;
  targetServerId: string | null;
  composeFiles: string[];
  composeProfiles: string[];
  serviceCount: number;
  config: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface DeploymentHealthSummaryOutput {
  status: "verified" | "failed" | "pending" | "not-configured";
  statusLabel: string;
  statusTone: string;
  summary: string;
  failureAnalysis: string | null;
  observedAt: string | null;
}

export interface RolloutStrategySummaryOutput {
  key: "compose-recreate" | "container-replace";
  label: string;
  summary: string;
  downtimeRisk: "possible" | "expected";
  supportsZeroDowntime: boolean;
  healthGate: "readiness-probe" | "docker-health" | "container-health";
}

export interface ServiceRuntimeSummaryOutput {
  status: "not-deployed" | "last-known-healthy" | "rollout-in-progress" | "attention";
  statusLabel: string;
  statusTone: string;
  summary: string;
  observedAt: string | null;
}

export interface ServiceReadOutput {
  id: string;
  name: string;
  slug: string;
  sourceType: string;
  status: string;
  statusTone: string;
  statusLabel: string;
  projectId: string;
  projectName: string | null;
  environmentId: string;
  environmentName: string | null;
  imageReference: string | null;
  dockerfilePath: string | null;
  composeServiceName: string | null;
  port: string | null;
  healthcheckPath: string | null;
  replicaCount: string;
  targetServerId: string | null;
  createdAt: string;
  updatedAt: string;
  config: unknown;
  managedDatabase: ManagedDatabaseConfigOutput | null;
  domainConfig: unknown;
  runtimeConfig: unknown;
  runtimeConfigPreview: string | null;
  runtimeSummary: ServiceRuntimeSummaryOutput;
  rolloutStrategy: RolloutStrategySummaryOutput;
  latestDeployment: {
    id: string;
    status: string;
    statusLabel: string;
    statusTone: string;
    summary: string;
    commitSha: string | null;
    imageTag: string | null;
    targetServerId: string;
    targetServerName: string | null;
    createdAt: string;
    finishedAt: string | null;
  } | null;
}

export interface ServiceMutationOutput {
  id: string;
  name: string;
  slug: string;
  sourceType: string;
  status: string;
  projectId: string;
  environmentId: string;
  imageReference: string | null;
  dockerfilePath: string | null;
  composeServiceName: string | null;
  port: string | null;
  healthcheckPath: string | null;
  replicaCount: string;
  targetServerId: string | null;
  createdAt: string;
  updatedAt: string;
  config: unknown;
  domainConfig: unknown;
  runtimeConfig: unknown;
  runtimeConfigPreview: string | null;
}

export interface ServiceScheduleOutput {
  id: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
  name: string;
  command: string;
  cronExpression: string;
  timezone: string;
  status: string;
  enabled: boolean;
  retentionCount: number;
  notifyOnFailure: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  createdByUserId: string | null;
  updatedByUserId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  serviceName?: string;
  projectName?: string;
  environmentName?: string;
}

export interface ServiceScheduleRunOutput {
  id: string;
  scheduleId: string;
  serviceId: string;
  triggerKind: string;
  status: string;
  command: string;
  logs: string;
  result: Record<string, unknown>;
  error: string | null;
  requestedByUserId: string | null;
  requestedByEmail: string | null;
  requestedByRole: string | null;
  startedAt: string | null;
  finishedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface ManagedDatabaseConfigOutput {
  kind: ManagedDatabaseKind;
  label: string;
  templateSlug: string;
  databaseName: string | null;
  username: string | null;
  port: string;
  internalPort: string;
  serviceName: string;
  volumeName: string;
  volumeId?: string | null;
  backupPolicyId?: string | null;
  backupType?: "database" | "volume";
  backupEngine?: string | null;
  connectionUriMasked: string;
  internalConnectionUriMasked: string;
  managedBy?: string;
  createdFrom?: string;
}

export interface ManagedDatabaseListItem {
  serviceId: string;
  serviceName: string;
  projectId: string;
  projectName: string;
  environmentId: string;
  status: string;
  targetServerId: string | null;
  createdAt: string;
  updatedAt: string;
  database: ManagedDatabaseConfigOutput;
  volume: unknown;
  backupPolicy: unknown;
}

export interface ManagedDatabaseStateMutationOutput {
  action: "start" | "restart" | "stop";
  deployment: {
    id: string;
    status: string;
  };
}

export interface ManagedDatabaseMutationOutput {
  service: ServiceMutationOutput;
  deployment: {
    id: string;
    status: string;
    targetServerId: string;
  };
  database: ManagedDatabaseConfigOutput;
}

export interface ProjectDetailsOutput extends ProjectListItem {
  environments: ProjectEnvironmentItem[];
}

export interface ProjectMutationOutput {
  id: string;
  name: string;
  slug: string | null;
  teamId: string;
  repoFullName: string | null;
  repoUrl: string | null;
  sourceType: string;
  composePath: string | null;
  status: string;
  gitProviderId: string | null;
  gitInstallationId: string | null;
  defaultBranch: string | null;
  autoDeploy: boolean;
  autoDeployBranch: string | null;
  createdByUserId: string | null;
  config: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface EnvironmentMutationOutput {
  id: string;
  projectId: string;
  name: string;
  slug: string;
  status: string;
  config: unknown;
  createdAt: string;
  updatedAt: string;
}

export interface CreateAgentInput {
  name: string;
  description?: string;
  preset?: string;
  scopes?: string[];
}

export interface CreateAgentOutput {
  id: string;
  name: string;
  defaultScopes: string | null;
}

export interface GenerateAgentTokenOutput {
  token: {
    id: string;
    name: string;
    tokenPrefix: string | null;
    status: string;
  };
  tokenValue: string;
}

export interface AgentTokenInventoryOutput {
  summary: {
    totalTokens: number;
    agentTokens: number;
    readOnlyTokens: number;
    planningTokens: number;
    commandTokens: number;
    inactiveTokens: number;
  };
  tokens: Array<{
    id: string;
    name: string;
    label: string;
    principalType: string;
    principalKind: string;
    principalRole: string;
    principalId: string;
    principalName: string;
    tokenPrefix: string | null;
    status: string;
    scopes: string[];
    lanes: string[];
    effectiveCapabilities: string[];
    withheldCapabilities: string[];
    isReadOnly: boolean;
    createdAt: string;
    expiresAt: string | null;
    lastUsedAt: string | null;
  }>;
}

export interface TriggerDeployOutput {
  id: string;
  serviceName: string;
}

export interface ConfigDiffOutput {
  a: {
    id: string;
    projectName: string;
    environmentName: string;
    serviceName: string;
    status: string;
    statusLabel: string;
    statusTone: string;
    commitSha: string | null;
    imageTag: string | null;
    sourceType: string;
    targetServerName: string | null;
    createdAt: string;
    finishedAt: string | null;
    stepCount: number;
  };
  b: {
    id: string;
    projectName: string;
    environmentName: string;
    serviceName: string;
    status: string;
    statusLabel: string;
    statusTone: string;
    commitSha: string | null;
    imageTag: string | null;
    sourceType: string;
    targetServerName: string | null;
    createdAt: string;
    finishedAt: string | null;
    stepCount: number;
  };
  summary: {
    sameProject: boolean;
    sameEnvironment: boolean;
    sameService: boolean;
    changedScalarCount: number;
    changedSnapshotKeyCount: number;
  };
  scalarChanges: Array<{
    key: string;
    baseline: unknown;
    comparison: unknown;
  }>;
  snapshotChanges: Array<{
    key: string;
    baseline: unknown;
    comparison: unknown;
  }>;
}

export interface NotificationChannelOutput {
  id: string;
  name: string;
  channelType: string;
  webhookUrl: string | null;
  email: string | null;
  projectFilter: string | null;
  environmentFilter: string | null;
  eventSelectors: string[];
  enabled: boolean;
  createdAt: string;
  updatedAt: string;
}

export interface NotificationDeliveryLogOutput {
  id: string;
  channelId: string;
  channelName: string;
  channelType: string;
  eventType: string;
  payload: unknown;
  httpStatus: string | null;
  status: string;
  error: string | null;
  sentAt: string;
}

export interface ManagedTunnelOutput {
  id: string;
  name: string;
  teamId: string;
  tunnelId: string | null;
  domain: string | null;
  status: string;
  config: unknown;
  hasCredentials: boolean;
  createdAt: string;
  updatedAt: string;
  routes: Array<{
    id: string;
    tunnelId: string;
    hostname: string;
    service: string;
    path: string | null;
    status: string;
    createdAt: string;
    updatedAt: string;
  }>;
}

export interface LogDrainOutput {
  id: string;
  name: string;
  teamId: string;
  destinationType: string;
  endpointUrl: string;
  hasHeaders: boolean;
  serviceFilter: string | null;
  environmentFilter: string | null;
  status: string;
  metadata: unknown;
  lastDeliveredAt: string | null;
  lastError: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface LogDrainDeliveryOutput {
  id: string;
  drainId: string;
  status: string;
  httpStatus: string | null;
  payload: unknown;
  responseBody: string | null;
  error: string | null;
  attemptedAt: string;
  completedAt: string | null;
}

export interface ManagedSshKeyOutput {
  id: string;
  teamId: string;
  name: string;
  username: string | null;
  fingerprint: string;
  keyType: string;
  hasPrivateKey: boolean;
  status: string;
  lastUsedAt: string | null;
  rotatedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface CertificateAssetOutput {
  id: string;
  teamId: string;
  name: string;
  fingerprint: string;
  subject: string | null;
  issuer: string | null;
  expiresAt: string | null;
  domains: string[];
  hasPrivateKey: boolean;
  hasCaChain: boolean;
  status: string;
  createdAt: string;
  updatedAt: string;
}

export interface DaoFlowTRPC {
  viewer: QueryProcedure<ViewerOutput>;
  health: QueryProcedure<HealthOutput>;
  approvalQueue: QueryProcedure<ApprovalQueueOutput, { limit?: number }>;
  serverReadiness: QueryProcedure<ServerReadinessOutput, { limit?: number }>;
  operationalMaintenanceReport: QueryProcedure<OperationalMaintenanceReportOutput>;
  runOperationalMaintenance: MutationProcedure<
    { dryRun?: boolean },
    OperationalMaintenanceRunOutput
  >;
  registerServer: MutationProcedure<
    {
      name: string;
      host: string;
      region: string;
      sshPort: number;
      sshUser?: string;
      sshPrivateKey?: string;
      sshKeyId?: string | null;
      kind: "docker-engine" | "docker-swarm-manager";
    },
    RegisterServerOutput
  >;
  configureServerManagedTraefikProxy: MutationProcedure<
    {
      serverId: string;
      enabled: boolean;
      networkName?: string | null;
      entrypoint?: string | null;
      certificateResolver?: string | null;
      dnsTarget?: string | null;
    },
    RegisterServerOutput
  >;
  deploymentPlan: QueryProcedure<
    DeploymentPlanPreview,
    {
      service: string;
      server?: string;
      image?: string;
      preview?: {
        target: "branch" | "pull-request";
        branch: string;
        pullRequestNumber?: number;
        action?: "deploy" | "destroy";
      };
    }
  >;
  composeDeploymentPlan: QueryProcedure<
    ComposeDeploymentPlanPreview,
    {
      server: string;
      compose: string;
      composeFiles?: Array<{
        path: string;
        contents: string;
      }>;
      composeProfiles?: string[];
      composePath?: string;
      contextPath?: string;
      localBuildContexts: Array<{
        serviceName: string;
        context: string;
        dockerfile?: string | null;
      }>;
      requiresContextUpload: boolean;
      contextBundle?: {
        fileCount: number;
        sizeBytes: number;
        includedOverrides: string[];
      } | null;
      contextBundleError?: string;
    }
  >;
  composePreviews: QueryProcedure<ComposePreviewsOutput, { serviceId: string }>;
  serviceSchedules: QueryProcedure<ServiceScheduleOutput[], { serviceId?: string; limit?: number }>;
  serviceScheduleRuns: QueryProcedure<
    { schedule: ServiceScheduleOutput; runs: ServiceScheduleRunOutput[] },
    { scheduleId: string; limit?: number }
  >;
  managedDatabases: QueryProcedure<ManagedDatabaseListItem[], { limit?: number }>;
  managedDatabaseCatalog: QueryProcedure<
    Array<{
      kind: ManagedDatabaseKind;
      label: string;
      templateSlug: string;
      defaultDatabaseName: string | null;
      defaultUsername: string | null;
      defaultPort: string;
      internalPort: string;
      serviceName: string;
    }>
  >;
  composeReleaseCatalog: QueryProcedure<ComposeReleaseCatalogOutput, { limit?: number }>;
  backupOverview: QueryProcedure<BackupOverviewOutput, { limit?: number }>;
  backupRunDetails: QueryProcedure<BackupRunDetailsOutput, { runId: string }>;
  persistentVolumes: QueryProcedure<PersistentVolumeRegistryOutput, { limit?: number }>;
  backupDestinations: QueryProcedure<BackupDestinationOutput[], { limit?: number }>;
  createVolume: MutationProcedure<
    {
      name: string;
      serverId: string;
      mountPath: string;
      sizeBytes?: number;
      driver?: string;
      serviceId?: string;
      status?: "active" | "inactive" | "paused";
    },
    VolumeMutationOutput
  >;
  updateVolume: MutationProcedure<
    {
      volumeId: string;
      name?: string;
      serverId?: string;
      mountPath?: string;
      sizeBytes?: number;
      driver?: string;
      serviceId?: string;
      status?: "active" | "inactive" | "paused";
    },
    VolumeMutationOutput
  >;
  deleteVolume: MutationProcedure<{ volumeId: string }, { deleted: boolean; volumeId: string }>;
  createBackupDestination: MutationProcedure<
    {
      name: string;
      provider: BackupProvider;
      accessKey?: string;
      secretAccessKey?: string;
      bucket?: string;
      region?: string;
      endpoint?: string;
      s3Provider?: string;
      rcloneType?: string;
      rcloneConfig?: string;
      rcloneRemotePath?: string;
      oauthToken?: string;
      localPath?: string;
    },
    BackupDestinationOutput
  >;
  createBackupPolicy: MutationProcedure<
    {
      name: string;
      volumeId: string;
      destinationId?: string;
      backupType?: "volume" | "database";
      databaseEngine?: "postgres" | "mysql" | "mariadb" | "mongo" | null;
      turnOff?: boolean;
      schedule?: string;
      retentionDays?: number;
      retentionDaily?: number;
      retentionWeekly?: number;
      retentionMonthly?: number;
      maxBackups?: number;
      status?: "active" | "paused";
    },
    BackupPolicyMutationOutput
  >;
  updateBackupPolicy: MutationProcedure<
    {
      policyId: string;
      name?: string;
      volumeId?: string;
      destinationId?: string;
      backupType?: "volume" | "database";
      databaseEngine?: "postgres" | "mysql" | "mariadb" | "mongo" | null;
      turnOff?: boolean;
      schedule?: string;
      retentionDays?: number;
      retentionDaily?: number;
      retentionWeekly?: number;
      retentionMonthly?: number;
      maxBackups?: number;
      status?: "active" | "paused";
    },
    BackupPolicyMutationOutput
  >;
  deleteBackupPolicy: MutationProcedure<
    { policyId: string },
    { deleted: boolean; policyId: string }
  >;
  testBackupDestination: MutationProcedure<{ id: string }, { success: boolean; error?: string }>;
  deleteBackupDestination: MutationProcedure<{ id: string }, { ok: true }>;
  enableBackupSchedule: MutationProcedure<
    { policyId: string; schedule: string },
    EnableBackupScheduleOutput
  >;
  disableBackupSchedule: MutationProcedure<{ policyId: string }, { ok: boolean }>;
  triggerBackupNow: MutationProcedure<{ policyId: string }, BackupRunOutput>;
  triggerTestRestore: MutationProcedure<{ backupRunId: string }, QueueRestoreOutput>;
  backupRestorePlan: QueryProcedure<BackupRestorePlanOutput, { backupRunId: string }>;
  queueBackupRestore: MutationProcedure<{ backupRunId: string }, QueueRestoreOutput>;
  controlPlaneRecoveryPlan: QueryProcedure<
    ControlPlaneRecoveryPlanOutput,
    { destinationId: string }
  >;
  controlPlaneRecoveryBundles: QueryProcedure<
    ControlPlaneRecoveryBundlesResult,
    { limit?: number }
  >;
  controlPlaneRecoveryBundle: QueryProcedure<
    ControlPlaneRecoveryBundleOutput,
    { bundleId: string }
  >;
  controlPlaneRecoveryBundleMetadata: QueryProcedure<
    ControlPlaneRecoveryBundleMetadataOutput,
    { bundleId: string }
  >;
  triggerControlPlaneRecoveryBundle: MutationProcedure<
    { destinationId: string },
    ControlPlaneRecoveryBundleOutput
  >;
  environmentVariables: QueryProcedure<
    EnvironmentVariablesOutput,
    {
      environmentId?: string;
      serviceId?: string;
      branch?: string;
      previewEnvironmentId?: string;
      limit?: number;
    }
  >;
  upsertEnvironmentVariable: MutationProcedure<
    {
      environmentId: string;
      key: string;
      value: string;
      isSecret: boolean;
      category: "runtime" | "build";
      source?: "inline" | "1password";
      secretRef?: string | null;
      branchPattern?: string;
    },
    UpsertEnvironmentVariableOutput
  >;
  deleteEnvironmentVariable: MutationProcedure<
    { environmentId: string; key: string },
    DeleteEnvironmentVariableOutput
  >;
  resolveEnvironmentSecrets: QueryProcedure<
    ResolveEnvironmentSecretsOutput,
    { environmentId: string }
  >;
  rollbackTargets: QueryProcedure<RollbackTarget[], { serviceId: string }>;
  rollbackPlan: QueryProcedure<RollbackPlanOutput, { service: string; target?: string }>;
  executeRollback: MutationProcedure<
    { serviceId: string; targetDeploymentId: string },
    RollbackExecutionOutput
  >;
  auditTrail: QueryProcedure<AuditTrailOutput, { limit?: number; since?: string }>;
  accessLogs: QueryProcedure<
    AccessLogsOutput,
    {
      limit?: number;
      cursor?: string;
      since?: string;
      status?: "failed-auth" | "denied" | "error" | "slow" | "webhook" | "api-token";
      method?: string;
      path?: string;
      actorType?: "user" | "service" | "agent" | "token";
      tokenId?: string;
      requestId?: string;
      search?: string;
      minDurationMs?: number;
    }
  >;
  approveApprovalRequest: MutationProcedure<{ requestId: string }, ApprovalQueueRequestOutput>;
  rejectApprovalRequest: MutationProcedure<{ requestId: string }, ApprovalQueueRequestOutput>;
  deploymentLogs: QueryProcedure<
    DeploymentLogsOutput,
    {
      deploymentId?: string;
      service?: string;
      query?: string;
      stream?: "all" | "stdout" | "stderr";
      limit?: number;
    }
  >;
  projects: QueryProcedure<ProjectListItem[], { limit?: number }>;
  projectDetails: QueryProcedure<ProjectDetailsOutput, { projectId: string }>;
  projectEnvironments: QueryProcedure<ProjectEnvironmentItem[], { projectId: string }>;
  services: QueryProcedure<ServiceReadOutput[], { environmentId?: string; limit?: number }>;
  serviceDetails: QueryProcedure<ServiceReadOutput, { serviceId: string }>;
  projectServices: QueryProcedure<ServiceReadOutput[], { projectId: string }>;
  createProject: MutationProcedure<
    {
      name: string;
      description?: string;
      repoUrl?: string;
      gitProviderId?: string;
      gitInstallationId?: string;
      repoFullName?: string;
      composePath?: string;
      composeFiles?: string[];
      composeProfiles?: string[];
      defaultBranch?: string;
      autoDeploy?: boolean;
      autoDeployBranch?: string;
      repositoryCredential?:
        | { kind: "https_token"; token: string; username?: string | null }
        | { kind: "https_basic"; username: string; password: string }
        | { kind: "ssh_key"; privateKey: string }
        | null;
    },
    ProjectMutationOutput
  >;
  updateProject: MutationProcedure<
    {
      projectId: string;
      name?: string;
      description?: string;
      repoUrl?: string;
      gitProviderId?: string;
      gitInstallationId?: string;
      repoFullName?: string;
      composePath?: string;
      composeFiles?: string[];
      composeProfiles?: string[];
      defaultBranch?: string;
      autoDeploy?: boolean;
      autoDeployBranch?: string;
      repositoryCredential?:
        | { kind: "https_token"; token: string; username?: string | null }
        | { kind: "https_basic"; username: string; password: string }
        | { kind: "ssh_key"; privateKey: string }
        | null;
    },
    ProjectMutationOutput
  >;
  deleteProject: MutationProcedure<{ projectId: string }, { deleted: boolean }>;
  createEnvironment: MutationProcedure<
    {
      projectId: string;
      name: string;
      targetServerId?: string;
      composeFiles?: string[];
      composeProfiles?: string[];
    },
    EnvironmentMutationOutput
  >;
  createService: MutationProcedure<
    {
      projectId: string;
      environmentId: string;
      name: string;
      sourceType: "compose" | "dockerfile" | "image";
      imageReference?: string;
      dockerfilePath?: string;
      composeServiceName?: string;
      port?: string;
      healthcheckPath?: string;
      targetServerId?: string;
    },
    ServiceMutationOutput
  >;
  createManagedDatabase: MutationProcedure<
    {
      kind: ManagedDatabaseKind;
      projectId: string;
      environmentName?: string;
      serverId: string;
      name?: string;
      databaseName?: string;
      username?: string;
      password?: string;
      rootPassword?: string;
      port?: string;
    },
    ManagedDatabaseMutationOutput
  >;
  setManagedDatabaseState: MutationProcedure<
    { serviceId: string; action: "start" | "restart" | "stop" },
    ManagedDatabaseStateMutationOutput
  >;
  deleteManagedDatabase: MutationProcedure<{ serviceId: string }, { deleted: boolean }>;
  createServiceSchedule: MutationProcedure<
    {
      serviceId: string;
      name: string;
      command: string;
      cronExpression: string;
      timezone?: string;
      retentionCount?: number;
      notifyOnFailure?: boolean;
    },
    ServiceScheduleOutput
  >;
  setServiceScheduleState: MutationProcedure<
    { scheduleId: string; state: "pause" | "resume" },
    ServiceScheduleOutput
  >;
  deleteServiceSchedule: MutationProcedure<
    { scheduleId: string },
    { status: "ok"; scheduleId: string }
  >;
  runServiceScheduleNow: MutationProcedure<{ scheduleId: string }, ServiceScheduleRunOutput>;
  updateServiceDomainRouting: MutationProcedure<
    {
      serviceId: string;
      domainId: string;
      routingMode: "observed" | "managed-traefik";
      targetPort?: number | null;
    },
    ServiceDomainStateOutput
  >;
  serverOperationsHub: QueryProcedure<
    ServerOperationsHubOutput,
    { serverId: string; limit?: number }
  >;
  serverOperationLogs: QueryProcedure<
    {
      operation: ServerOperationRecord;
      logs: Array<{ id: number; stream: string; message: string; createdAt: string }>;
    },
    { operationId: string; limit?: number }
  >;
  collectServerResources: MutationProcedure<{ serverId: string }, ServerOperationMutationOutput>;
  previewServerCleanup: MutationProcedure<
    { serverId: string; includeVolumes?: boolean },
    ServerOperationMutationOutput
  >;
  runServerCleanup: MutationProcedure<
    { serverId: string; includeVolumes?: boolean },
    ServerOperationMutationOutput
  >;
  planServerPatches: MutationProcedure<{ serverId: string }, ServerOperationMutationOutput>;
  refreshSwarmTopology: MutationProcedure<{ serverId: string }, ServerOperationMutationOutput>;
  updateSwarmNodeAvailability: MutationProcedure<
    {
      serverId: string;
      node: string;
      availability: "active" | "pause" | "drain";
      dryRun?: boolean;
    },
    ServerOperationMutationOutput
  >;
  updateSwarmServiceScale: MutationProcedure<
    {
      serverId: string;
      service: string;
      replicas: number;
      dryRun?: boolean;
    },
    ServerOperationMutationOutput
  >;
  updateEnvironment: MutationProcedure<
    {
      environmentId: string;
      name?: string;
      status?: string;
      targetServerId?: string;
      composeFiles?: string[];
      composeProfiles?: string[];
    },
    EnvironmentMutationOutput
  >;
  deleteEnvironment: MutationProcedure<{ environmentId: string }, { deleted: boolean }>;
  cancelDeployment: MutationProcedure<
    { deploymentId: string },
    { status: "cancelled"; deploymentId: string }
  >;
  createAgent: MutationProcedure<CreateAgentInput, CreateAgentOutput>;
  generateAgentToken: MutationProcedure<
    { principalId: string; tokenName: string; expiresInDays?: number },
    GenerateAgentTokenOutput
  >;
  agentTokenInventory: QueryProcedure<AgentTokenInventoryOutput>;
  revokeAgentToken: MutationProcedure<{ tokenId: string }, { status: "ok" }>;
  triggerDeploy: MutationProcedure<
    {
      serviceId: string;
      commitSha?: string;
      imageTag?: string;
      preview?: {
        target: "branch" | "pull-request";
        branch: string;
        pullRequestNumber?: number;
        action?: "deploy" | "destroy";
      };
    },
    TriggerDeployOutput
  >;
  listChannels: QueryProcedure<NotificationChannelOutput[]>;
  listDeliveryLogs: QueryProcedure<NotificationDeliveryLogOutput[], { limit: number }>;
  managedTunnels: QueryProcedure<ManagedTunnelOutput[]>;
  managedTunnel: QueryProcedure<ManagedTunnelOutput, { tunnelId: string }>;
  createManagedTunnel: MutationProcedure<
    {
      name: string;
      tunnelId?: string | null;
      domain?: string | null;
      credentials?: string | null;
    },
    ManagedTunnelOutput
  >;
  updateManagedTunnel: MutationProcedure<
    {
      tunnelId: string;
      name?: string;
      providerTunnelId?: string | null;
      domain?: string | null;
      status?: "active" | "inactive" | "error";
    },
    ManagedTunnelOutput
  >;
  syncManagedTunnelRoutes: MutationProcedure<
    {
      tunnelId: string;
      routes: Array<{
        hostname: string;
        service: string;
        path?: string | null;
        status?: "active" | "inactive" | "error";
      }>;
    },
    ManagedTunnelOutput
  >;
  rotateManagedTunnelCredentials: MutationProcedure<
    { tunnelId: string; credentials: string },
    ManagedTunnelOutput
  >;
  deleteManagedTunnel: MutationProcedure<{ tunnelId: string }, { deleted: true; tunnelId: string }>;
  logDrains: QueryProcedure<LogDrainOutput[]>;
  logDrainDeliveries: QueryProcedure<LogDrainDeliveryOutput[], { limit?: number }>;
  managedSshKeys: QueryProcedure<ManagedSshKeyOutput[]>;
  certificateAssets: QueryProcedure<CertificateAssetOutput[]>;
  createManagedSshKey: MutationProcedure<
    { name: string; username?: string | null; privateKey: string },
    ManagedSshKeyOutput
  >;
  rotateManagedSshKey: MutationProcedure<
    { keyId: string; privateKey: string },
    ManagedSshKeyOutput
  >;
  attachManagedSshKeyToServer: MutationProcedure<
    { keyId: string; serverId: string },
    { server: RegisterServerOutput; key: ManagedSshKeyOutput }
  >;
  detachManagedSshKeyFromServer: MutationProcedure<
    { serverId: string },
    { server: RegisterServerOutput; detachedKeyId: string | null }
  >;
  deleteManagedSshKey: MutationProcedure<{ keyId: string }, { deleted: true; keyId: string }>;
  createCertificateAsset: MutationProcedure<
    {
      name: string;
      certificatePem: string;
      privateKey?: string | null;
      caChain?: string | null;
    },
    CertificateAssetOutput
  >;
  deleteCertificateAsset: MutationProcedure<
    { certificateId: string },
    { deleted: true; certificateId: string }
  >;
  createLogDrain: MutationProcedure<
    {
      name: string;
      destinationType: "webhook" | "generic_http" | "loki" | "s3";
      endpointUrl: string;
      headers?: Record<string, string>;
      serviceFilter?: string | null;
      environmentFilter?: string | null;
    },
    LogDrainOutput
  >;
  deleteLogDrain: MutationProcedure<{ drainId: string }, { deleted: true; drainId: string }>;
  testLogDrain: MutationProcedure<
    { drainId: string },
    { drain: LogDrainOutput; delivery: LogDrainDeliveryOutput }
  >;
  retryLogDrainDelivery: MutationProcedure<
    { deliveryId: string },
    { originalDeliveryId: string; drainName: string; delivery: LogDrainDeliveryOutput }
  >;
  configDiff: QueryProcedure<ConfigDiffOutput, { deploymentIdA: string; deploymentIdB: string }>;
  eventTimeline: QueryProcedure<
    {
      summary: { totalEvents: number; returnedEvents: number };
      events: {
        id: string;
        kind: string;
        resourceType: string;
        resourceId: string;
        summary: string;
        detail: string | null;
        severity: string;
        metadata: unknown;
        createdAt: string;
      }[];
    },
    { limit?: number; since?: string; kind?: string; severity?: string }
  >;
  deploymentDetails: QueryProcedure<Record<string, unknown>, { deploymentId: string }>;
  composeDriftReport: QueryProcedure<
    {
      inspection: {
        availability: "not-implemented";
        blockers: string[];
        limits: { minimumIntervalSeconds: number; maxConcurrentPerServer: number };
        collection: { composePsFormat: "json"; inspectFields: string[] };
        persistence: { allowed: string[]; forbidden: string[] };
      };
      summary: {
        totalServices: number;
        cachedSnapshotServices: number;
        unavailableServices: number;
        driftedServices: number;
        blockedServices: number;
        reviewRequired: number;
      };
      reports: {
        composeServiceId: string;
        environmentId: string;
        environmentName: string;
        projectId: string;
        projectName: string;
        serviceName: string;
        composeFilePath: string | null;
        target: {
          serverId: string | null;
          serverName: string | null;
          composeProjectName: string | null;
        };
        source: "cached-snapshot" | "unavailable";
        authoritative: false;
        attemptedAt: string | null;
        observedAt: string | null;
        maxAgeSeconds: number;
        evidenceRefs: string[];
        status: "drifted" | "blocked" | "unavailable";
        statusLabel: string;
        statusTone: "running" | "failed";
        summary: string;
        impactSummary: string | null;
        desiredImageReference: string | null;
        actualImageReference: string | null;
        desiredReplicaCount: number | null;
        actualReplicaCount: number | null;
        actualContainerState: string | null;
        recommendedActions: string[];
        diffs: {
          id: string;
          field: string;
          desiredValue: string;
          actualValue: string;
          impact: string;
        }[];
      }[];
    },
    { limit?: number }
  >;
}
