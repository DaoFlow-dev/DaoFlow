import {
  getDeploymentStatusTone,
  normalizeInventoryStatus,
  normalizeServerReadinessStatus,
  type StatusTone
} from "@daoflow/shared";

export type StatusBadgeVariant = "default" | "secondary" | "destructive" | "outline";

/**
 * tone-utils.ts
 *
 * Status tone mappers and formatting utilities shared across
 * dashboard components. Extracted from App.tsx for reusability.
 */

export function getInventoryTone(status: string): StatusTone {
  return normalizeInventoryStatus(status);
}

export function getBadgeVariantFromTone(tone: string): StatusBadgeVariant {
  if (tone === "healthy") {
    return "default";
  }

  if (tone === "failed") {
    return "destructive";
  }

  return "secondary";
}

export function getToneTextClass(tone: string): string {
  if (tone === "healthy") {
    return "text-emerald-500";
  }

  if (tone === "failed") {
    return "text-red-500";
  }

  if (tone === "running") {
    return "text-amber-500";
  }

  return "text-zinc-400";
}

export function getToneDotClass(tone: string, options?: { pulse?: boolean }): string {
  const pulse = options?.pulse === true && tone === "running" ? " animate-pulse" : "";

  if (tone === "healthy") {
    return `bg-emerald-500${pulse}`;
  }

  if (tone === "failed") {
    return `bg-red-500${pulse}`;
  }

  if (tone === "running") {
    return `bg-amber-500${pulse}`;
  }

  return `bg-zinc-400${pulse}`;
}

export function getInventoryBadgeVariant(status: string): StatusBadgeVariant {
  return getBadgeVariantFromTone(getInventoryTone(status));
}

export function getInventoryDotClass(status: string, options?: { pulse?: boolean }): string {
  return getToneDotClass(getInventoryTone(status), options);
}

export function getExecutionJobTone(status: string): StatusTone {
  if (status === "completed") {
    return "healthy";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "pending") {
    return "queued";
  }

  return "running";
}

export function getDeploymentTone(status: string, conclusion: string | null): StatusTone {
  return getDeploymentStatusTone(status, conclusion);
}

export function getDeploymentBadgeVariant(
  status: string,
  conclusion: string | null
): StatusBadgeVariant {
  return getBadgeVariantFromTone(getDeploymentTone(status, conclusion));
}

export function getDeploymentStepTone(status: string): StatusTone {
  if (status === "completed") {
    return "healthy";
  }

  if (status === "failed") {
    return "failed";
  }

  if (status === "running") {
    return "running";
  }

  return "queued";
}

export function getTimelineLifecycle(kind: string) {
  if (kind === "deployment.failed" || kind === "execution.job.failed" || kind === "step.failed") {
    return "failed" as const;
  }

  if (
    kind === "deployment.succeeded" ||
    kind === "execution.job.completed" ||
    kind === "step.completed"
  ) {
    return "completed" as const;
  }

  if (kind === "execution.job.dispatched" || kind === "step.running") {
    return "running" as const;
  }

  return "queued" as const;
}

export function getTimelineTone(kind: string): StatusTone {
  const lifecycle = getTimelineLifecycle(kind);

  if (lifecycle === "failed") {
    return "failed";
  }

  if (lifecycle === "completed") {
    return "healthy";
  }

  return "queued";
}

export function getAuditTone(action: string): StatusTone {
  if (action === "execution.complete" || action === "approval.approve") {
    return "healthy";
  }

  if (action === "execution.fail" || action === "approval.reject") {
    return "failed";
  }

  if (action === "execution.dispatch") {
    return "running";
  }

  return "queued";
}

export function getLogTone(stream: string): StatusTone {
  return stream === "stderr" ? "failed" : "queued";
}

export function getServerReadinessTone(status: string): StatusTone {
  return normalizeServerReadinessStatus(status);
}

export function getPersistentVolumeTone(coverage: string, restoreReadiness: string): StatusTone {
  if (coverage === "missing") {
    return "failed";
  }

  if (coverage === "stale" || restoreReadiness === "stale" || restoreReadiness === "untested") {
    return "running";
  }

  return "healthy";
}

export function getComposeDriftTone(status: string): StatusTone {
  if (status === "aligned") {
    return "healthy";
  }

  if (status === "blocked") {
    return "failed";
  }

  return "running";
}

export function getApprovalTone(status: string, riskLevel: string): StatusTone {
  if (status === "approved") {
    return "healthy";
  }

  if (status === "rejected") {
    return "failed";
  }

  return riskLevel === "critical" ? "failed" : "running";
}

export function formatBytes(bytes: number) {
  if (bytes < 1024) {
    return `${bytes} B`;
  }

  const units = ["KB", "MB", "GB", "TB"];
  let value = bytes;
  let unitIndex = -1;

  while (value >= 1024 && unitIndex < units.length - 1) {
    value /= 1024;
    unitIndex += 1;
  }

  return `${new Intl.NumberFormat("en-US", {
    maximumFractionDigits: 1
  }).format(value)} ${units[unitIndex]}`;
}
