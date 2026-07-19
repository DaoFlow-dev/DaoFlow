import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { webhookDeliveries, webhookDeliveryAttempts } from "../schema/webhook-deliveries";
import { newId } from "./json-helpers";
import { sanitizeWebhookDeliveryMetadata } from "./webhook-delivery-recovery-redaction";
import {
  findWebhookDeliveryAttempt,
  isLiveProcessingAttempt,
  isTerminalDeliveryStatus
} from "./webhook-delivery-recovery-lease";
import { addWebhookDeliveryTargetKeys } from "./webhook-delivery-recovery-targets";
import {
  normalizeWebhookDeliveryClaimInput,
  type ClaimWebhookDeliveryRecoveryInput,
  type WebhookDeliveryClaimResult
} from "./webhook-delivery-recovery-types";

export function hashWebhookDeliveryBody(rawBody: string | Uint8Array) {
  return createHash("sha256").update(rawBody).digest("hex");
}

function isRetryableLegacyDeliveryStatus(status: string) {
  return status === "processing" || status === "failed" || status === "partial";
}

export async function claimWebhookDeliveryRecovery(
  input: ClaimWebhookDeliveryRecoveryInput
): Promise<WebhookDeliveryClaimResult> {
  const normalized = normalizeWebhookDeliveryClaimInput(input);
  const bodyDigest = hashWebhookDeliveryBody(input.rawBody);
  const metadata = sanitizeWebhookDeliveryMetadata(input.metadata);
  const leaseExpiresAt = new Date(normalized.now.getTime() + normalized.leaseDurationMs);
  const createdDeliveryId = newId();
  const createdAttemptId = newId();

  return db.transaction(async (tx) => {
    const [created] = await tx
      .insert(webhookDeliveries)
      .values({
        id: createdDeliveryId,
        providerType: normalized.providerType,
        eventType: normalized.eventType,
        deliveryKey: normalized.deliveryKey,
        deliveryId: normalized.deliveryId,
        repoFullName: normalized.repoFullName,
        externalInstallationId: normalized.externalInstallationId,
        commitSha: normalized.commitSha,
        bodyDigest,
        currentAttemptId: createdAttemptId,
        attemptCount: 1,
        status: "processing",
        metadata,
        lastSeenAt: normalized.now,
        createdAt: normalized.now
      })
      .onConflictDoNothing({
        target: [webhookDeliveries.providerType, webhookDeliveries.deliveryKey]
      })
      .returning();

    if (created) {
      await tx.insert(webhookDeliveryAttempts).values({
        id: createdAttemptId,
        deliveryId: created.id,
        attemptNumber: 1,
        status: "processing",
        leaseOwner: normalized.leaseToken,
        leaseExpiresAt,
        startedAt: normalized.now,
        createdAt: normalized.now,
        updatedAt: normalized.now
      });
      await addWebhookDeliveryTargetKeys(tx, created.id, normalized.targetKeys, normalized.now);
      return {
        kind: "new",
        deliveryId: created.id,
        attemptId: createdAttemptId,
        leaseToken: normalized.leaseToken,
        leaseExpiresAt
      };
    }

    const [existing] = await tx
      .select()
      .from(webhookDeliveries)
      .where(
        and(
          eq(webhookDeliveries.providerType, normalized.providerType),
          eq(webhookDeliveries.deliveryKey, normalized.deliveryKey)
        )
      )
      .limit(1)
      .for("update");

    if (!existing) {
      throw new Error("Webhook delivery insert conflicted without a persisted delivery.");
    }
    let storedBodyDigest = existing.bodyDigest;
    if (storedBodyDigest === null) {
      if (!isRetryableLegacyDeliveryStatus(existing.status)) {
        await tx
          .update(webhookDeliveries)
          .set({ lastSeenAt: normalized.now })
          .where(eq(webhookDeliveries.id, existing.id));
        return {
          kind: "terminal_duplicate",
          deliveryId: existing.id,
          attemptId: existing.currentAttemptId,
          leaseToken: null,
          terminalStatus: "legacy"
        };
      }

      storedBodyDigest = bodyDigest;
      await tx
        .update(webhookDeliveries)
        .set({ bodyDigest, lastSeenAt: normalized.now })
        .where(eq(webhookDeliveries.id, existing.id));
    }
    if (storedBodyDigest !== bodyDigest) {
      return {
        kind: "body_digest_collision",
        deliveryId: existing.id,
        attemptId: null,
        leaseToken: null
      };
    }
    if (isTerminalDeliveryStatus(existing.status)) {
      await tx
        .update(webhookDeliveries)
        .set({ lastSeenAt: normalized.now })
        .where(eq(webhookDeliveries.id, existing.id));
      return {
        kind: "terminal_duplicate",
        deliveryId: existing.id,
        attemptId: existing.currentAttemptId,
        leaseToken: null,
        terminalStatus: existing.status
      };
    }

    const currentAttempt = await findWebhookDeliveryAttempt(tx, existing.currentAttemptId);
    if (currentAttempt && isLiveProcessingAttempt(currentAttempt, normalized.now)) {
      await tx
        .update(webhookDeliveries)
        .set({ lastSeenAt: normalized.now })
        .where(eq(webhookDeliveries.id, existing.id));
      return {
        kind: "live_duplicate",
        deliveryId: existing.id,
        attemptId: currentAttempt.id,
        leaseToken: null,
        leaseExpiresAt: currentAttempt.leaseExpiresAt
      };
    }

    if (currentAttempt?.status === "processing") {
      await tx
        .update(webhookDeliveryAttempts)
        .set({
          status: "expired",
          errorSummary: "Webhook delivery lease expired before completion.",
          completedAt: normalized.now,
          updatedAt: normalized.now
        })
        .where(eq(webhookDeliveryAttempts.id, currentAttempt.id));
    }

    const attemptId = newId();
    const attemptNumber = Math.max(existing.attemptCount, currentAttempt?.attemptNumber ?? 0) + 1;
    await tx.insert(webhookDeliveryAttempts).values({
      id: attemptId,
      deliveryId: existing.id,
      attemptNumber,
      status: "processing",
      leaseOwner: normalized.leaseToken,
      leaseExpiresAt,
      startedAt: normalized.now,
      createdAt: normalized.now,
      updatedAt: normalized.now
    });
    await tx
      .update(webhookDeliveries)
      .set({
        currentAttemptId: attemptId,
        attemptCount: attemptNumber,
        status: "processing",
        detail: null,
        lastErrorSummary: null,
        lastSeenAt: normalized.now,
        processedAt: null
      })
      .where(eq(webhookDeliveries.id, existing.id));
    await addWebhookDeliveryTargetKeys(tx, existing.id, normalized.targetKeys, normalized.now);

    return {
      kind: "reclaimed",
      deliveryId: existing.id,
      attemptId,
      leaseToken: normalized.leaseToken,
      leaseExpiresAt
    };
  });
}
