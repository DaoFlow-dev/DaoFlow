import type { Context } from "hono";
import type { WebhookDeliveryClaimResult } from "../db/services/webhook-delivery-recovery";
import { writeWebhookAuditEntry } from "./webhooks-delivery";

function providerLabel(providerType: "github" | "gitlab") {
  return providerType === "github" ? "GitHub" : "GitLab";
}

export async function respondToNonActiveWebhookClaim(input: {
  context: Context;
  claim: WebhookDeliveryClaimResult;
  providerType: "github" | "gitlab";
  repoFullName: string;
  branch: string;
  commitSha: string;
  actorId: string;
  actorEmail: string;
  providerDeliveryId?: string | null;
  deliveryKey: string;
}) {
  if (input.claim.kind === "new" || input.claim.kind === "reclaimed") {
    throw new Error("Active webhook claims cannot use the duplicate response path.");
  }
  const label = providerLabel(input.providerType);
  const commit = input.commitSha ? input.commitSha.slice(0, 7) : "unknown";
  const auditBase = {
    providerType: input.providerType,
    repoFullName: input.repoFullName,
    actorId: input.actorId,
    actorEmail: input.actorEmail
  } as const;
  const metadata = {
    repoFullName: input.repoFullName,
    branch: input.branch,
    commitSha: input.commitSha,
    deliveryId: input.providerDeliveryId ?? null,
    deliveryKey: input.deliveryKey
  };

  if (input.claim.kind === "body_digest_collision") {
    await writeWebhookAuditEntry({
      ...auditBase,
      action: "webhook.delivery.collision",
      inputSummary: `Rejected reused ${label} delivery identity for ${input.branch}@${commit}`,
      outcome: "denied",
      metadata
    });
    return input.context.json(
      { ok: false, error: "Delivery identity does not match payload." },
      409
    );
  }

  if (input.claim.kind === "live_duplicate") {
    const retryAfterSeconds = Math.max(
      1,
      Math.ceil((input.claim.leaseExpiresAt.getTime() - Date.now()) / 1_000)
    );
    input.context.header("Retry-After", String(retryAfterSeconds));
    await writeWebhookAuditEntry({
      ...auditBase,
      action: "webhook.delivery.in_progress",
      inputSummary: `Deferred concurrent ${label} push delivery for ${input.branch}@${commit}`,
      outcome: "failure",
      metadata
    });
    return input.context.json({ ok: false, error: "Delivery is still being processed." }, 503);
  }

  await writeWebhookAuditEntry({
    ...auditBase,
    action: "webhook.delivery.duplicate",
    inputSummary: `Ignored duplicate ${label} push delivery for ${input.branch}@${commit}`,
    outcome: "success",
    metadata: { ...metadata, duplicateKind: input.claim.kind }
  });
  return input.context.json({ ok: true, skipped: true, reason: "duplicate delivery" });
}
