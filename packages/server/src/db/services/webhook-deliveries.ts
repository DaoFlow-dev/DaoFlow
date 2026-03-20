import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { webhookDeliveries } from "../schema/webhook-deliveries";
import { newId } from "./json-helpers";

export type WebhookDeliveryProviderType = "github" | "gitlab";
export type WebhookDeliveryStatus =
  | "processing"
  | "queued"
  | "ignored"
  | "rejected"
  | "failed"
  | "partial";

export function buildWebhookDeliveryKey(input: {
  providerType: WebhookDeliveryProviderType;
  eventType: string;
  rawBody: string;
  deliveryId?: string | null;
}): { deliveryId: string | null; deliveryKey: string } {
  const deliveryId = input.deliveryId?.trim() || null;
  if (deliveryId) {
    return {
      deliveryId,
      deliveryKey: deliveryId
    };
  }

  const fingerprint = createHash("sha256")
    .update(`${input.providerType}:${input.eventType}:${input.rawBody}`)
    .digest("hex");

  return {
    deliveryId: null,
    deliveryKey: fingerprint
  };
}

export async function claimWebhookDelivery(input: {
  providerType: WebhookDeliveryProviderType;
  eventType: string;
  rawBody: string;
  deliveryId?: string | null;
  repoFullName?: string | null;
  externalInstallationId?: string | null;
  commitSha?: string | null;
  metadata?: Record<string, unknown>;
}) {
  const { deliveryId, deliveryKey } = buildWebhookDeliveryKey(input);
  const [created] = await db
    .insert(webhookDeliveries)
    .values({
      id: newId(),
      providerType: input.providerType,
      eventType: input.eventType,
      deliveryKey,
      deliveryId,
      repoFullName: input.repoFullName ?? null,
      externalInstallationId: input.externalInstallationId ?? null,
      commitSha: input.commitSha ?? null,
      status: "processing",
      metadata: input.metadata ?? {},
      lastSeenAt: new Date()
    })
    .onConflictDoNothing()
    .returning();

  if (created) {
    return {
      status: "claimed" as const,
      delivery: created,
      deliveryKey
    };
  }

  const [existing] = await db
    .update(webhookDeliveries)
    .set({
      lastSeenAt: new Date()
    })
    .where(
      and(
        eq(webhookDeliveries.providerType, input.providerType),
        eq(webhookDeliveries.deliveryKey, deliveryKey)
      )
    )
    .returning();

  return {
    status: "duplicate" as const,
    delivery: existing ?? null,
    deliveryKey
  };
}

export async function finalizeWebhookDelivery(input: {
  providerType: WebhookDeliveryProviderType;
  deliveryKey: string;
  status: WebhookDeliveryStatus;
  metadata: Record<string, unknown>;
}) {
  const [updated] = await db
    .update(webhookDeliveries)
    .set({
      status: input.status,
      metadata: input.metadata,
      lastSeenAt: new Date(),
      processedAt: new Date()
    })
    .where(
      and(
        eq(webhookDeliveries.providerType, input.providerType),
        eq(webhookDeliveries.deliveryKey, input.deliveryKey)
      )
    )
    .returning();

  return updated ?? null;
}
