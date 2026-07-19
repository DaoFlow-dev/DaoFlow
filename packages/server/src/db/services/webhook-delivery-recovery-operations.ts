import { and, asc, eq } from "drizzle-orm";
import { db } from "../connection";
import {
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookDeliveryTargets
} from "../schema/webhook-deliveries";
import { newId } from "./json-helpers";
import { sanitizeWebhookDeliveryDetail } from "./webhook-delivery-recovery-redaction";
import { requireActiveWebhookDeliveryLease } from "./webhook-delivery-recovery-lease";
import {
  isTerminalWebhookDeliveryTargetStatus,
  RETRY_ELIGIBLE_TARGET_STATUSES,
  summarizeWebhookDeliveryTargets,
  upsertWebhookDeliveryTargetOutcomes
} from "./webhook-delivery-recovery-targets";
import {
  normalizeWebhookDeliveryLeaseDuration,
  normalizeWebhookDeliveryLeaseInput,
  normalizeWebhookDeliveryTargetKeys,
  type BeginWebhookDeliveryTargetInput,
  type BeginWebhookDeliveryTargetResult,
  type CompleteWebhookDeliveryAttemptInput,
  type CompleteWebhookDeliveryAttemptResult,
  type ListWebhookDeliveryRetryEligibleTargetKeysInput,
  type ListWebhookDeliveryRetryEligibleTargetKeysResult,
  type RecordWebhookDeliveryTargetOutcomeInput,
  type RecordWebhookDeliveryTargetOutcomeResult,
  type RenewWebhookDeliveryLeaseInput,
  type RenewWebhookDeliveryLeaseResult,
  type WebhookDeliveryCompletionOutcome
} from "./webhook-delivery-recovery-types";

function deliveryStatusForOutcome(outcome: WebhookDeliveryCompletionOutcome) {
  return outcome === "success" ? "succeeded" : outcome;
}

function deriveDeliveryStatusFromTargets(
  requestedOutcome: WebhookDeliveryCompletionOutcome,
  targets: Array<{ status: string }>
) {
  if (targets.length === 0) {
    return deliveryStatusForOutcome(requestedOutcome);
  }

  const summary = summarizeWebhookDeliveryTargets(targets);
  if (summary.failedTargetCount > 0 || summary.pendingTargetCount > 0) {
    return summary.terminalTargetCount > 0 ? "partial" : "failed";
  }
  if (targets.some((target) => target.status === "completed")) {
    return "succeeded";
  }
  if (targets.every((target) => target.status === "rejected")) {
    return "rejected";
  }
  return "ignored";
}

export async function listWebhookDeliveryRetryEligibleTargetKeys(
  input: ListWebhookDeliveryRetryEligibleTargetKeysInput
): Promise<ListWebhookDeliveryRetryEligibleTargetKeysResult> {
  const normalized = normalizeWebhookDeliveryLeaseInput(input);

  return db.transaction(async (tx) => {
    const lease = await requireActiveWebhookDeliveryLease(tx, normalized);
    if (lease.status === "stale_lease") {
      return {
        status: "stale_lease",
        targetKeys: [],
        targetSummary: {
          totalTargetCount: 0,
          terminalTargetCount: 0,
          failedTargetCount: 0,
          pendingTargetCount: 0
        }
      };
    }

    const targets = await tx
      .select({
        targetKey: webhookDeliveryTargets.targetKey,
        status: webhookDeliveryTargets.status
      })
      .from(webhookDeliveryTargets)
      .where(eq(webhookDeliveryTargets.deliveryId, normalized.deliveryId))
      .orderBy(asc(webhookDeliveryTargets.targetKey));

    return {
      status: "active",
      targetKeys: targets
        .filter((target) =>
          RETRY_ELIGIBLE_TARGET_STATUSES.includes(
            target.status as (typeof RETRY_ELIGIBLE_TARGET_STATUSES)[number]
          )
        )
        .map((target) => target.targetKey),
      targetSummary: summarizeWebhookDeliveryTargets(targets)
    };
  });
}

export async function beginWebhookDeliveryTarget(
  input: BeginWebhookDeliveryTargetInput
): Promise<BeginWebhookDeliveryTargetResult> {
  const normalizedLease = normalizeWebhookDeliveryLeaseInput(input);
  const [targetKey] = normalizeWebhookDeliveryTargetKeys([input.targetKey]);
  if (!targetKey) {
    throw new Error("Webhook delivery target key is required.");
  }

  return db.transaction(async (tx) => {
    const lease = await requireActiveWebhookDeliveryLease(tx, normalizedLease);
    if (lease.status === "stale_lease") {
      return { status: "stale_lease" };
    }

    const [existing] = await tx
      .select()
      .from(webhookDeliveryTargets)
      .where(
        and(
          eq(webhookDeliveryTargets.deliveryId, normalizedLease.deliveryId),
          eq(webhookDeliveryTargets.targetKey, targetKey)
        )
      )
      .limit(1)
      .for("update");

    if (existing && isTerminalWebhookDeliveryTargetStatus(existing.status)) {
      return { status: "already_terminal", targetKey };
    }

    if (existing) {
      await tx
        .update(webhookDeliveryTargets)
        .set({
          status: "pending",
          lastAttemptId: normalizedLease.attemptId,
          detail: null,
          errorSummary: null,
          completedAt: null,
          updatedAt: normalizedLease.now
        })
        .where(eq(webhookDeliveryTargets.id, existing.id));
    } else {
      await tx.insert(webhookDeliveryTargets).values({
        id: newId(),
        deliveryId: normalizedLease.deliveryId,
        targetKey,
        status: "pending",
        lastAttemptId: normalizedLease.attemptId,
        createdAt: normalizedLease.now,
        updatedAt: normalizedLease.now
      });
    }

    return { status: "begun", targetKey };
  });
}

export async function recordWebhookDeliveryTargetOutcome(
  input: RecordWebhookDeliveryTargetOutcomeInput
): Promise<RecordWebhookDeliveryTargetOutcomeResult> {
  const normalizedLease = normalizeWebhookDeliveryLeaseInput(input);

  return db.transaction(async (tx) => {
    const lease = await requireActiveWebhookDeliveryLease(tx, normalizedLease);
    if (lease.status === "stale_lease") {
      return { status: "stale_lease" };
    }

    const [targetOutcome] = await upsertWebhookDeliveryTargetOutcomes(tx, {
      deliveryId: normalizedLease.deliveryId,
      attemptId: normalizedLease.attemptId,
      targetOutcomes: [input],
      now: normalizedLease.now
    });
    if (!targetOutcome) {
      throw new Error("Webhook delivery target outcome was not recorded.");
    }
    return targetOutcome;
  });
}

export async function renewWebhookDeliveryLease(
  input: RenewWebhookDeliveryLeaseInput
): Promise<RenewWebhookDeliveryLeaseResult> {
  const normalizedLease = normalizeWebhookDeliveryLeaseInput(input);
  const leaseExpiresAt = new Date(
    normalizedLease.now.getTime() + normalizeWebhookDeliveryLeaseDuration(input.leaseDurationMs)
  );

  return db.transaction(async (tx) => {
    const lease = await requireActiveWebhookDeliveryLease(tx, normalizedLease);
    if (lease.status === "stale_lease") {
      return { status: "stale_lease" };
    }

    await tx
      .update(webhookDeliveryAttempts)
      .set({ leaseExpiresAt, updatedAt: normalizedLease.now })
      .where(eq(webhookDeliveryAttempts.id, normalizedLease.attemptId));
    await tx
      .update(webhookDeliveries)
      .set({ lastSeenAt: normalizedLease.now })
      .where(eq(webhookDeliveries.id, normalizedLease.deliveryId));

    return {
      status: "renewed",
      deliveryId: normalizedLease.deliveryId,
      attemptId: normalizedLease.attemptId,
      leaseExpiresAt
    };
  });
}

export async function completeWebhookDeliveryAttempt(
  input: CompleteWebhookDeliveryAttemptInput
): Promise<CompleteWebhookDeliveryAttemptResult> {
  const normalizedLease = normalizeWebhookDeliveryLeaseInput(input);
  const detail = sanitizeWebhookDeliveryDetail(input.detail);
  const errorSummary = sanitizeWebhookDeliveryDetail(input.errorSummary);

  return db.transaction(async (tx) => {
    const lease = await requireActiveWebhookDeliveryLease(tx, normalizedLease);
    if (lease.status === "stale_lease") {
      return { status: "stale_lease" };
    }

    const targetOutcomes = await upsertWebhookDeliveryTargetOutcomes(tx, {
      deliveryId: normalizedLease.deliveryId,
      attemptId: normalizedLease.attemptId,
      targetOutcomes: input.targetOutcomes ?? [],
      now: normalizedLease.now
    });
    const persistedTargets = await tx
      .select({ status: webhookDeliveryTargets.status })
      .from(webhookDeliveryTargets)
      .where(eq(webhookDeliveryTargets.deliveryId, normalizedLease.deliveryId))
      .for("update");
    const deliveryStatus = deriveDeliveryStatusFromTargets(input.outcome, persistedTargets);
    const retryableFailure = deliveryStatus === "failed" || deliveryStatus === "partial";
    const safeErrorSummary = retryableFailure ? (errorSummary ?? detail) : null;

    await tx
      .update(webhookDeliveryAttempts)
      .set({
        status: deliveryStatus,
        errorSummary: safeErrorSummary,
        completedAt: normalizedLease.now,
        updatedAt: normalizedLease.now
      })
      .where(eq(webhookDeliveryAttempts.id, normalizedLease.attemptId));
    await tx
      .update(webhookDeliveries)
      .set({
        status: deliveryStatus,
        detail,
        lastErrorSummary: safeErrorSummary,
        lastSeenAt: normalizedLease.now,
        processedAt: normalizedLease.now
      })
      .where(eq(webhookDeliveries.id, normalizedLease.deliveryId));

    return {
      status: "completed",
      deliveryId: normalizedLease.deliveryId,
      attemptId: normalizedLease.attemptId,
      targetOutcomes
    };
  });
}
