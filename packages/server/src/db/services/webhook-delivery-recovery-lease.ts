import { eq } from "drizzle-orm";
import { webhookDeliveries, webhookDeliveryAttempts } from "../schema/webhook-deliveries";
import type { WebhookDeliveryLeaseResult } from "./webhook-delivery-recovery-types";
import type { WebhookDeliveryRecoveryTransaction } from "./webhook-delivery-recovery-transaction";

const TERMINAL_DELIVERY_STATUSES = ["succeeded", "rejected", "ignored"] as const;

export function isTerminalDeliveryStatus(
  status: string
): status is "succeeded" | "rejected" | "ignored" {
  return TERMINAL_DELIVERY_STATUSES.includes(status as (typeof TERMINAL_DELIVERY_STATUSES)[number]);
}

export function isLiveProcessingAttempt(
  attempt: { status: string; leaseExpiresAt: Date },
  now: Date
) {
  return attempt.status === "processing" && attempt.leaseExpiresAt.getTime() > now.getTime();
}

export async function findWebhookDeliveryAttempt(
  tx: WebhookDeliveryRecoveryTransaction,
  attemptId: string | null
) {
  if (!attemptId) {
    return null;
  }

  const [attempt] = await tx
    .select()
    .from(webhookDeliveryAttempts)
    .where(eq(webhookDeliveryAttempts.id, attemptId))
    .limit(1)
    .for("update");
  return attempt ?? null;
}

export async function requireActiveWebhookDeliveryLease(
  tx: WebhookDeliveryRecoveryTransaction,
  input: { deliveryId: string; attemptId: string; leaseToken: string; now: Date }
): Promise<WebhookDeliveryLeaseResult> {
  const [delivery] = await tx
    .select()
    .from(webhookDeliveries)
    .where(eq(webhookDeliveries.id, input.deliveryId))
    .limit(1)
    .for("update");

  if (!delivery || delivery.currentAttemptId !== input.attemptId) {
    return { status: "stale_lease" };
  }

  const attempt = await findWebhookDeliveryAttempt(tx, input.attemptId);
  if (
    !attempt ||
    attempt.leaseOwner !== input.leaseToken ||
    !isLiveProcessingAttempt(attempt, input.now)
  ) {
    return { status: "stale_lease" };
  }

  return {
    status: "active",
    deliveryId: delivery.id,
    attemptId: attempt.id,
    leaseExpiresAt: attempt.leaseExpiresAt
  };
}
