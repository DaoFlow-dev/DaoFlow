import type { AnyRouter } from "@trpc/server";
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
    averageLatencyMs: number | null;
  };
  checks: Array<{
    serverId: string;
    serverName: string;
    serverHost: string;
    targetKind: string;
    serverStatus: string;
    readinessStatus: string;
    sshPort: number;
    sshReachable: boolean;
    dockerReachable: boolean;
    composeReachable: boolean;
    latencyMs: number | null;
    checkedAt: string;
    issues: string[];
    recommendedActions: string[];
  }>;
}

export interface RouterOutputs {
  viewer: ViewerOutput;
  health: HealthOutput;
  serverReadiness: ServerReadinessOutput;
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
    projectName: string;
    environmentName: string;
    serviceName: string;
    targetType: "volume" | "database";
    storageProvider: string;
    scheduleLabel: string;
    retentionCount: number;
    nextRunAt: string | null;
    lastRunAt: string | null;
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

export interface ProjectListItem {
  id: string;
  name: string;
  description: string | null;
  repoUrl: string | null;
  defaultBranch: string | null;
  composePath: string | null;
  autoDeploy: boolean | null;
  createdByUserId: string | null;
  config: unknown;
  createdAt: Date;
  updatedAt: Date;
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

export interface DaoFlowTRPC {
  viewer: QueryProcedure<ViewerOutput>;
  health: QueryProcedure<HealthOutput>;
  serverReadiness: QueryProcedure<ServerReadinessOutput, { limit?: number }>;
  deploymentPlan: QueryProcedure<
    DeploymentPlanPreview,
    { service: string; server?: string; image?: string }
  >;
  composeDeploymentPlan: QueryProcedure<
    ComposeDeploymentPlanPreview,
    {
      server: string;
      compose: string;
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
  composeReleaseCatalog: QueryProcedure<ComposeReleaseCatalogOutput, { limit?: number }>;
  backupOverview: QueryProcedure<BackupOverviewOutput, { limit?: number }>;
  backupDestinations: QueryProcedure<BackupDestinationOutput[], { limit?: number }>;
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
  testBackupDestination: MutationProcedure<{ id: string }, { success: boolean; error?: string }>;
  deleteBackupDestination: MutationProcedure<{ id: string }, { ok: true }>;
  enableBackupSchedule: MutationProcedure<
    { policyId: string; schedule: string },
    EnableBackupScheduleOutput
  >;
  disableBackupSchedule: MutationProcedure<{ policyId: string }, { ok: boolean }>;
  triggerBackupNow: MutationProcedure<{ policyId: string }, BackupRunOutput>;
  triggerTestRestore: MutationProcedure<{ backupRunId: string }, QueueRestoreOutput>;
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
  deploymentLogs: QueryProcedure<DeploymentLogsOutput, { deploymentId?: string; limit?: number }>;
  projects: QueryProcedure<ProjectListItem[], { limit?: number }>;
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
    { serviceId: string; commitSha?: string; imageTag?: string },
    TriggerDeployOutput
  >;
  configDiff: QueryProcedure<ConfigDiffOutput, { deploymentIdA: string; deploymentIdB: string }>;
}
