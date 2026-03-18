export const StatusTone = {
  Healthy: "healthy",
  Failed: "failed",
  Running: "running",
  Queued: "queued"
} as const;

export type StatusTone = (typeof StatusTone)[keyof typeof StatusTone];

export const DeploymentLifecycleStatus = {
  Queued: "queued",
  Prepare: "prepare",
  Deploy: "deploy",
  Finalize: "finalize",
  Completed: "completed",
  Failed: "failed",
  Running: "running"
} as const;

export type DeploymentLifecycleStatus =
  (typeof DeploymentLifecycleStatus)[keyof typeof DeploymentLifecycleStatus];

export const DeploymentConclusion = {
  Succeeded: "succeeded",
  Failed: "failed",
  Cancelled: "cancelled",
  Skipped: "skipped"
} as const;

export type DeploymentConclusion = (typeof DeploymentConclusion)[keyof typeof DeploymentConclusion];

export const DeploymentHealthStatus = {
  Healthy: "healthy",
  Failed: "failed",
  Running: "running",
  Queued: "queued"
} as const;

export type DeploymentHealthStatus =
  (typeof DeploymentHealthStatus)[keyof typeof DeploymentHealthStatus];

export const DeploymentStepStatus = {
  Pending: "pending",
  Running: "running",
  Completed: "completed",
  Failed: "failed"
} as const;

export type DeploymentStepStatus = (typeof DeploymentStepStatus)[keyof typeof DeploymentStepStatus];

export const ServerReadinessStatus = {
  Ready: "ready",
  Attention: "attention",
  Blocked: "blocked",
  Healthy: "healthy",
  Degraded: "degraded"
} as const;

export type ServerReadinessStatus =
  (typeof ServerReadinessStatus)[keyof typeof ServerReadinessStatus];

export const ExecutionJobStatus = {
  Pending: "pending",
  Dispatched: "dispatched",
  Completed: "completed",
  Failed: "failed"
} as const;

export type ExecutionJobStatus = (typeof ExecutionJobStatus)[keyof typeof ExecutionJobStatus];

export const deploymentHealthStatuses = [
  DeploymentHealthStatus.Healthy,
  DeploymentHealthStatus.Failed,
  DeploymentHealthStatus.Running,
  DeploymentHealthStatus.Queued
] as const;

export const executionJobStatuses = [
  ExecutionJobStatus.Pending,
  ExecutionJobStatus.Dispatched,
  ExecutionJobStatus.Completed,
  ExecutionJobStatus.Failed
] as const;

export function normalizeDeploymentStatus(
  status: string,
  conclusion: string | null
): DeploymentHealthStatus {
  if (status === DeploymentLifecycleStatus.Failed || conclusion === DeploymentConclusion.Failed) {
    return DeploymentHealthStatus.Failed;
  }

  if (conclusion === DeploymentConclusion.Cancelled) {
    return DeploymentHealthStatus.Failed;
  }

  if (
    status === DeploymentLifecycleStatus.Completed &&
    conclusion === DeploymentConclusion.Succeeded
  ) {
    return DeploymentHealthStatus.Healthy;
  }

  if (
    status === DeploymentLifecycleStatus.Prepare ||
    status === DeploymentLifecycleStatus.Deploy ||
    status === DeploymentLifecycleStatus.Finalize ||
    status === DeploymentLifecycleStatus.Running
  ) {
    return DeploymentHealthStatus.Running;
  }

  return DeploymentHealthStatus.Queued;
}

export function getDeploymentStatusTone(status: string, conclusion: string | null): StatusTone {
  return normalizeDeploymentStatus(status, conclusion);
}

export function formatDeploymentStatusLabel(status: string, conclusion: string | null): string {
  if (conclusion === DeploymentConclusion.Cancelled) {
    return "Cancelled";
  }

  if (status === DeploymentLifecycleStatus.Completed) {
    if (conclusion === DeploymentConclusion.Succeeded) {
      return "Healthy";
    }

    if (conclusion === DeploymentConclusion.Skipped) {
      return "Skipped";
    }

    if (conclusion === DeploymentConclusion.Failed) {
      return "Failed";
    }
  }

  switch (status) {
    case DeploymentLifecycleStatus.Queued:
      return "Queued";
    case DeploymentLifecycleStatus.Prepare:
      return "Preparing";
    case DeploymentLifecycleStatus.Deploy:
      return "Deploying";
    case DeploymentLifecycleStatus.Finalize:
      return "Finalizing";
    case DeploymentLifecycleStatus.Running:
      return "Running";
    case DeploymentLifecycleStatus.Failed:
      return "Failed";
    default:
      return "Queued";
  }
}

export function canCancelDeployment(status: string, conclusion: string | null): boolean {
  const normalized = normalizeDeploymentStatus(status, conclusion);
  return (
    normalized === DeploymentHealthStatus.Queued || normalized === DeploymentHealthStatus.Running
  );
}

export function canRollbackDeployment(
  status: string,
  conclusion: string | null,
  hasServiceTarget: boolean
): boolean {
  return (
    hasServiceTarget &&
    status === DeploymentLifecycleStatus.Completed &&
    conclusion === DeploymentConclusion.Succeeded
  );
}

export function normalizeServerReadinessStatus(status: string): StatusTone {
  if (status === ServerReadinessStatus.Ready || status === ServerReadinessStatus.Healthy) {
    return StatusTone.Healthy;
  }

  if (status === ServerReadinessStatus.Attention || status === ServerReadinessStatus.Degraded) {
    return StatusTone.Running;
  }

  return StatusTone.Failed;
}

export function normalizeInventoryStatus(status: string): StatusTone {
  if (
    status === ServerReadinessStatus.Ready ||
    status === ServerReadinessStatus.Healthy ||
    status === "active" ||
    status === DeploymentConclusion.Succeeded
  ) {
    return StatusTone.Healthy;
  }

  if (status === DeploymentConclusion.Failed || status === "offline" || status === "rejected") {
    return StatusTone.Failed;
  }

  if (
    status === DeploymentLifecycleStatus.Running ||
    status === ServerReadinessStatus.Degraded ||
    status === ServerReadinessStatus.Attention
  ) {
    return StatusTone.Running;
  }

  return StatusTone.Queued;
}
