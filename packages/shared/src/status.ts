export const StatusTone = {
  Healthy: "healthy",
  Failed: "failed",
  Running: "running",
  Queued: "queued"
} as const;

export type StatusTone = (typeof StatusTone)[keyof typeof StatusTone];

export const DeploymentHealthStatus = {
  Healthy: "healthy",
  Failed: "failed",
  Running: "running",
  Queued: "queued"
} as const;

export type DeploymentHealthStatus =
  (typeof DeploymentHealthStatus)[keyof typeof DeploymentHealthStatus];

export const ServerReadinessStatus = {
  Ready: "ready",
  Attention: "attention",
  Blocked: "blocked"
} as const;

export type ServerReadinessStatus =
  (typeof ServerReadinessStatus)[keyof typeof ServerReadinessStatus];

export function normalizeDeploymentStatus(
  status: string,
  conclusion: string | null
): DeploymentHealthStatus {
  if (status === "failed" || conclusion === "failed") {
    return DeploymentHealthStatus.Failed;
  }

  if (status === "completed" && conclusion === "succeeded") {
    return DeploymentHealthStatus.Healthy;
  }

  if (
    status === "deploy" ||
    status === "prepare" ||
    status === "finalize" ||
    status === "running"
  ) {
    return DeploymentHealthStatus.Running;
  }

  return DeploymentHealthStatus.Queued;
}

export function normalizeServerReadinessStatus(status: string): StatusTone {
  if (status === "ready" || status === "healthy") {
    return StatusTone.Healthy;
  }

  if (status === "attention" || status === "degraded") {
    return StatusTone.Running;
  }

  return StatusTone.Failed;
}

export function normalizeInventoryStatus(status: string): StatusTone {
  if (status === "ready" || status === "healthy" || status === "active" || status === "succeeded") {
    return StatusTone.Healthy;
  }

  if (status === "failed" || status === "offline" || status === "rejected") {
    return StatusTone.Failed;
  }

  if (status === "running" || status === "degraded" || status === "attention") {
    return StatusTone.Running;
  }

  return StatusTone.Queued;
}
