export interface DeploymentStepData {
  id: string | number;
  label: string;
  status?: string | null;
  detail?: string | null;
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
}
