import { and, eq } from "drizzle-orm";
import { webhookDeliveryTargets } from "../schema/webhook-deliveries";
import { newId } from "./json-helpers";
import { sanitizeWebhookDeliveryDetail } from "./webhook-delivery-recovery-redaction";
import type {
  WebhookDeliveryTargetOutcomeInput,
  WebhookDeliveryTargetSummary
} from "./webhook-delivery-recovery-types";
import { normalizeWebhookDeliveryTargetKeys } from "./webhook-delivery-recovery-types";
import type { WebhookDeliveryRecoveryTransaction } from "./webhook-delivery-recovery-transaction";

export const RETRY_ELIGIBLE_TARGET_STATUSES = ["pending", "failed"] as const;
export const TERMINAL_TARGET_STATUSES = ["completed", "ignored", "rejected"] as const;

export function isTerminalWebhookDeliveryTargetStatus(status: string) {
  return TERMINAL_TARGET_STATUSES.includes(status as (typeof TERMINAL_TARGET_STATUSES)[number]);
}

export async function addWebhookDeliveryTargetKeys(
  tx: WebhookDeliveryRecoveryTransaction,
  deliveryId: string,
  targetKeys: readonly string[],
  now: Date
) {
  if (targetKeys.length === 0) {
    return;
  }

  await tx
    .insert(webhookDeliveryTargets)
    .values(
      targetKeys.map((targetKey) => ({
        id: newId(),
        deliveryId,
        targetKey,
        status: "pending",
        createdAt: now,
        updatedAt: now
      }))
    )
    .onConflictDoNothing({
      target: [webhookDeliveryTargets.deliveryId, webhookDeliveryTargets.targetKey]
    });
}

export async function upsertWebhookDeliveryTargetOutcomes(
  tx: WebhookDeliveryRecoveryTransaction,
  input: {
    deliveryId: string;
    attemptId: string;
    targetOutcomes: readonly WebhookDeliveryTargetOutcomeInput[];
    now: Date;
  }
) {
  const outcomes = new Map(
    input.targetOutcomes.map((outcome) => [
      normalizeWebhookDeliveryTargetKeys([outcome.targetKey])[0],
      outcome
    ])
  );
  const results: Array<{ targetKey: string; status: "stored" | "already_terminal" }> = [];

  for (const [targetKey, targetOutcome] of outcomes) {
    const [existing] = await tx
      .select()
      .from(webhookDeliveryTargets)
      .where(
        and(
          eq(webhookDeliveryTargets.deliveryId, input.deliveryId),
          eq(webhookDeliveryTargets.targetKey, targetKey)
        )
      )
      .limit(1)
      .for("update");

    if (existing && isTerminalWebhookDeliveryTargetStatus(existing.status)) {
      results.push({ targetKey, status: "already_terminal" });
      continue;
    }

    const detail = sanitizeWebhookDeliveryDetail(targetOutcome.detail);
    const errorSummary = sanitizeWebhookDeliveryDetail(targetOutcome.errorSummary);
    const values = {
      status: targetOutcome.status,
      lastAttemptId: input.attemptId,
      detail,
      errorSummary: targetOutcome.status === "failed" ? errorSummary : null,
      completedAt: targetOutcome.status === "failed" ? null : input.now,
      updatedAt: input.now
    };

    if (existing) {
      await tx
        .update(webhookDeliveryTargets)
        .set(values)
        .where(eq(webhookDeliveryTargets.id, existing.id));
    } else {
      await tx.insert(webhookDeliveryTargets).values({
        id: newId(),
        deliveryId: input.deliveryId,
        targetKey,
        createdAt: input.now,
        ...values
      });
    }
    results.push({ targetKey, status: "stored" });
  }

  return results;
}

export function summarizeWebhookDeliveryTargets(targets: Array<{ status: string }>) {
  const targetSummary: WebhookDeliveryTargetSummary = {
    totalTargetCount: targets.length,
    terminalTargetCount: targets.filter((target) =>
      isTerminalWebhookDeliveryTargetStatus(target.status)
    ).length,
    failedTargetCount: targets.filter((target) => target.status === "failed").length,
    pendingTargetCount: targets.filter((target) => target.status === "pending").length
  };
  return targetSummary;
}
