import type { deployments } from "../schema/deployments";
import type { previewEnvironments } from "../schema/preview-environments";

type PreviewEnvironmentRow = typeof previewEnvironments.$inferSelect;
type DeploymentRow = typeof deployments.$inferSelect;

export type PreviewLifecycleStatus =
  | "deploying"
  | "active"
  | "failed"
  | "stale"
  | "cleaning"
  | "cleaned_up";

export function toPreviewStatus(input: {
  action: "deploy" | "destroy";
  deploymentStatus?: string | null;
  deploymentConclusion?: string | null;
}): PreviewLifecycleStatus {
  if (input.deploymentStatus === "failed" || input.deploymentConclusion === "failed") {
    return "failed";
  }

  if (input.action === "destroy") {
    return input.deploymentStatus === "completed" && input.deploymentConclusion === "succeeded"
      ? "cleaned_up"
      : "cleaning";
  }

  return input.deploymentStatus === "completed" && input.deploymentConclusion === "succeeded"
    ? "active"
    : "deploying";
}

export function toCleanupStatus(input: {
  action: "deploy" | "destroy";
  deploymentStatus?: string | null;
  deploymentConclusion?: string | null;
}) {
  if (input.action === "deploy") {
    return "not_requested";
  }
  if (input.deploymentStatus === "failed" || input.deploymentConclusion === "failed") {
    return "failed";
  }
  return input.deploymentStatus === "completed" && input.deploymentConclusion === "succeeded"
    ? "completed"
    : "requested";
}

export function displayStatusForRow(row: PreviewEnvironmentRow): PreviewLifecycleStatus {
  if (row.status === "active" && row.staleAt && row.staleAt.getTime() <= Date.now()) {
    return "stale";
  }
  return row.status as PreviewLifecycleStatus;
}

export function deploymentFinishedAt(deployment: DeploymentRow | null) {
  return deployment?.concludedAt?.toISOString() ?? null;
}
