export interface DeploymentStepData {
  id: string | number;
  label: string;
  status?: string | null;
  detail?: string | null;
}

export interface DeploymentStateDeclaredData {
  sourceType: string;
  deploymentSource?: string | null;
  repoFullName?: string | null;
  repoUrl?: string | null;
  branch?: string | null;
  composeServiceName?: string | null;
  composeFiles: string[];
  composeProfiles: string[];
  stackName?: string | null;
  targetServerName?: string | null;
  targetServerHost?: string | null;
  targetServerKind?: string | null;
}

export interface DeploymentStateEffectiveData {
  composeOperation?: "up" | "down" | null;
  composeEnvBranch?: string | null;
  readinessProbe?: {
    type: string;
    target: string;
    serviceName: string;
    port: number;
    path?: string;
    host?: string;
    scheme?: string;
    intervalSeconds: number;
    timeoutSeconds: number;
  } | null;
  imageOverride?: {
    serviceName: string;
    imageReference: string;
  } | null;
  runtimeConfig?: {
    volumes: Array<{
      source: string;
      target: string;
      mode: "rw" | "ro";
    }>;
    networks: string[];
    restartPolicy: {
      name: "always" | "unless-stopped" | "on-failure" | "no";
      maxRetries: number | null;
    } | null;
    healthCheck: {
      command: string;
      intervalSeconds: number;
      timeoutSeconds: number;
      retries: number;
      startPeriodSeconds: number;
    } | null;
    resources: {
      cpuLimitCores: number | null;
      cpuReservationCores: number | null;
      memoryLimitMb: number | null;
      memoryReservationMb: number | null;
    } | null;
  } | null;
  runtimeConfigPreview?: string | null;
  preview?: {
    mode?: string;
    branch?: string;
    envBranch?: string;
    stackName?: string;
    action?: string;
    pullRequestNumber?: number | null;
  } | null;
  composeEnv?: {
    status: string;
    branch: string;
    fileName: string;
    precedence: string[];
    counts: {
      total: number;
      repoDefaults: number;
      environmentVariables: number;
      runtime: number;
      build: number;
      secrets: number;
      overriddenRepoDefaults: number;
    };
    warnings: string[];
    entries: Array<{
      key: string;
      displayValue: string;
      category: string;
      isSecret: boolean;
      source: string;
      branchPattern: string | null;
      origin: string;
      overrodeRepoDefault: boolean;
    }>;
  } | null;
  replayableSnapshot: Record<string, unknown>;
}

export interface DeploymentStateLiveRuntimeData {
  status: string;
  statusLabel: string;
  statusTone: string;
  summary: string;
  checkedAt?: string | null;
  actualContainerState?: string | null;
  desiredImageReference?: string | null;
  actualImageReference?: string | null;
  desiredReplicaCount?: number | null;
  actualReplicaCount?: number | null;
  impactSummary?: string | null;
  recommendedActions: string[];
  diffs: Array<{
    field: string;
    desiredValue: string;
    actualValue: string;
    impact: string;
  }>;
}

export interface DeploymentStateArtifactsData {
  declaredConfig: DeploymentStateDeclaredData;
  effectiveDeployment: DeploymentStateEffectiveData;
  liveRuntime: DeploymentStateLiveRuntimeData | null;
}

export interface DeploymentRowData {
  id: string | number;
  serviceId?: string | null;
  serviceName?: string | null;
  projectId?: string | null;
  environmentName?: string | null;
  targetServerName?: string | null;
  statusTone: string;
  statusLabel: string;
  lifecycleStatus?: string | null;
  status?: string | null;
  sourceType?: string | null;
  createdAt?: string | Date | null;
  canRollback?: boolean;
  conclusion?: string | null;
  requestedByEmail?: string | null;
  commitSha?: string | null;
  imageTag?: string | null;
  executionEngine?: "temporal" | "legacy";
  temporalWorkflowId?: string | null;
  temporalRunId?: string | null;
  steps?: DeploymentStepData[];
  stateArtifacts?: DeploymentStateArtifactsData | null;
}
