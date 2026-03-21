import { deployments } from "../db/schema/deployments";
import { asRecord } from "../db/services/json-helpers";
import { readComposePreviewMetadata } from "../compose-preview";

export interface PreviewWebhookDeployFailure {
  serviceId: string;
  status: string;
  entity?: string;
  message?: string;
}

export function summarizeCommit(commitSha: string) {
  return commitSha ? commitSha.slice(0, 7) : "unknown";
}

export function readPreviewFailureMessage(result: {
  status: string;
  entity?: string;
  message?: string;
}) {
  if (result.status === "not_found" && result.entity) {
    return `Missing ${result.entity}.`;
  }

  return result.message;
}

export function shouldDeduplicatePreviewRequest(input: {
  latestDeployment: typeof deployments.$inferSelect | null;
  commitSha: string;
  requestedAction: "deploy" | "destroy";
}) {
  if (!input.latestDeployment) {
    return false;
  }

  const preview = readComposePreviewMetadata(
    asRecord(input.latestDeployment.configSnapshot).preview
  );
  if (!preview || preview.action !== input.requestedAction) {
    return false;
  }

  const conclusion = (input.latestDeployment.conclusion ?? "").toLowerCase();
  if (
    input.latestDeployment.status === "failed" ||
    conclusion === "failed" ||
    conclusion === "canceled" ||
    conclusion === "cancelled"
  ) {
    return false;
  }

  if (input.requestedAction === "destroy") {
    return true;
  }

  return (input.latestDeployment.commitSha ?? "") === input.commitSha;
}

export function resolvePreviewDeliveryOutcome(input: {
  queued: number;
  deduped: number;
  ignored: number;
  failedTargets: number;
}) {
  if (
    (input.queued > 0 && (input.deduped > 0 || input.ignored > 0 || input.failedTargets > 0)) ||
    (input.failedTargets > 0 && (input.deduped > 0 || input.ignored > 0))
  ) {
    return "mixed" as const;
  }
  if (input.queued > 0) {
    return "queued" as const;
  }
  if (input.failedTargets > 0) {
    return "failed" as const;
  }
  if (input.deduped > 0 && input.ignored === 0) {
    return "deduped" as const;
  }
  return "ignored" as const;
}
