import type { AnyRouter } from "@trpc/server";
import type { SwarmTopologySnapshot } from "@daoflow/shared";
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

export interface RouterOutputs {
  viewer: ViewerOutput;
  health: HealthOutput;
  serverReadiness: ServerReadinessOutput;
  auditTrail: AuditTrailOutput;
  approvalQueue: ApprovalQueueOutput;
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
  status: string;
  targetPath: string;
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
  verifiedAt: string | null;
  startedAt: string;
  finishedAt: string | null;
  error: string | null;
  restoreCount: number;
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
  kind: string;
  status: string;
  dockerVersion: string | null;
  composeVersion: string | null;
  metadata?: {
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

export interface DaoFlowTRPC {
  viewer: QueryProcedure<ViewerOutput>;
  health: QueryProcedure<HealthOutput>;
  approvalQueue: QueryProcedure<ApprovalQueueOutput, { limit?: number }>;
  serverReadiness: QueryProcedure<ServerReadinessOutput, { limit?: number }>;
  registerServer: MutationProcedure<
    {
      name: string;
      host: string;
      region: string;
      sshPort: number;
      sshUser?: string;
      sshPrivateKey?: string;
      kind: "docker-engine" | "docker-swarm-manager";
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
  environmentVariables: QueryProcedure<
    EnvironmentVariablesOutput,
    { environmentId?: string; limit?: number }
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
  auditTrail: QueryProcedure<AuditTrailOutput, { limit?: number }>;
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
      repoFullName?: string;
      composePath?: string;
      composeFiles?: string[];
      composeProfiles?: string[];
      defaultBranch?: string;
      autoDeploy?: boolean;
      autoDeployBranch?: string;
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
  configDiff: QueryProcedure<ConfigDiffOutput, { deploymentIdA: string; deploymentIdB: string }>;
}
