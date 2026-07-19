import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import {
  webhookDeliveries,
  webhookDeliveryAttempts,
  webhookDeliveryTargets
} from "../schema/webhook-deliveries";
import { resetTestDatabase } from "../../test-db";
import {
  beginWebhookDeliveryTarget,
  claimWebhookDeliveryRecovery,
  completeWebhookDeliveryAttempt,
  listWebhookDeliveryRetryEligibleTargetKeys,
  recordWebhookDeliveryTargetOutcome,
  type ClaimWebhookDeliveryRecoveryInput,
  type WebhookDeliveryClaimResult
} from "./webhook-delivery-recovery";

const START = new Date("2026-07-18T12:00:00.000Z");

function at(offsetMs: number) {
  return new Date(START.getTime() + offsetMs);
}

function claimInput(
  deliveryKey: string,
  overrides: Partial<ClaimWebhookDeliveryRecoveryInput> = {}
): ClaimWebhookDeliveryRecoveryInput {
  return {
    providerType: "github",
    eventType: "push",
    deliveryKey,
    rawBody: '{"ref":"refs/heads/main"}',
    leaseToken: "lease-token-one",
    now: START,
    ...overrides
  };
}

function requireOwnedLease(result: WebhookDeliveryClaimResult) {
  if (result.kind !== "new" && result.kind !== "reclaimed") {
    throw new Error(`Expected an owned lease, received ${result.kind}.`);
  }
  return result;
}

describe("webhook delivery recovery ledger", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("returns only failed targets after a partial completion", async () => {
    const claimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-retry-filter", {
          targetKeys: ["project:proj_ignored", "service:svc_completed", "service:svc_retry"]
        })
      )
    );

    await completeWebhookDeliveryAttempt({
      deliveryId: claimed.deliveryId,
      attemptId: claimed.attemptId,
      leaseToken: claimed.leaseToken,
      outcome: "partial",
      targetOutcomes: [
        { targetKey: "project:proj_ignored", status: "ignored" },
        { targetKey: "service:svc_completed", status: "completed" },
        { targetKey: "service:svc_retry", status: "failed", errorSummary: "queue failed" }
      ],
      now: at(100)
    });

    const reclaimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-retry-filter", { leaseToken: "lease-token-two", now: at(200) })
      )
    );
    await expect(
      listWebhookDeliveryRetryEligibleTargetKeys({
        deliveryId: reclaimed.deliveryId,
        attemptId: reclaimed.attemptId,
        leaseToken: reclaimed.leaseToken,
        now: at(201)
      })
    ).resolves.toEqual({
      status: "active",
      targetKeys: ["service:svc_retry"],
      targetSummary: {
        totalTargetCount: 3,
        terminalTargetCount: 2,
        failedTargetCount: 1,
        pendingTargetCount: 0
      }
    });
  });

  it("keeps incrementally completed targets out of a reclaimed lease while retrying begun pending targets", async () => {
    const claimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-incremental-targets", { leaseDurationMs: 1_000 })
      )
    );

    await beginWebhookDeliveryTarget({
      deliveryId: claimed.deliveryId,
      attemptId: claimed.attemptId,
      leaseToken: claimed.leaseToken,
      targetKey: "service:svc_completed",
      now: at(100)
    });
    await recordWebhookDeliveryTargetOutcome({
      deliveryId: claimed.deliveryId,
      attemptId: claimed.attemptId,
      leaseToken: claimed.leaseToken,
      targetKey: "service:svc_completed",
      status: "completed",
      now: at(200)
    });
    await beginWebhookDeliveryTarget({
      deliveryId: claimed.deliveryId,
      attemptId: claimed.attemptId,
      leaseToken: claimed.leaseToken,
      targetKey: "service:svc_pending",
      now: at(300)
    });

    const reclaimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-incremental-targets", {
          leaseToken: "lease-token-two",
          now: at(1_001)
        })
      )
    );
    await expect(
      listWebhookDeliveryRetryEligibleTargetKeys({
        deliveryId: reclaimed.deliveryId,
        attemptId: reclaimed.attemptId,
        leaseToken: reclaimed.leaseToken,
        now: at(1_002)
      })
    ).resolves.toEqual({
      status: "active",
      targetKeys: ["service:svc_pending"],
      targetSummary: {
        totalTargetCount: 2,
        terminalTargetCount: 1,
        failedTargetCount: 0,
        pendingTargetCount: 1
      }
    });
  });

  it("distinguishes an empty target ledger from a fully terminal ledger after reclaim", async () => {
    const emptyClaim = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-empty-ledger", { leaseDurationMs: 1_000 })
      )
    );
    const emptyReclaimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-empty-ledger", { leaseToken: "lease-token-two", now: at(1_001) })
      )
    );
    await expect(
      listWebhookDeliveryRetryEligibleTargetKeys({
        deliveryId: emptyReclaimed.deliveryId,
        attemptId: emptyReclaimed.attemptId,
        leaseToken: emptyReclaimed.leaseToken,
        now: at(1_002)
      })
    ).resolves.toMatchObject({
      status: "active",
      targetKeys: [],
      targetSummary: {
        totalTargetCount: 0,
        terminalTargetCount: 0,
        failedTargetCount: 0,
        pendingTargetCount: 0
      }
    });

    const terminalClaim = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-terminal-ledger", {
          leaseToken: "lease-token-three",
          targetKeys: ["project:proj_ignored", "service:svc_completed"],
          leaseDurationMs: 1_000
        })
      )
    );
    await recordWebhookDeliveryTargetOutcome({
      deliveryId: terminalClaim.deliveryId,
      attemptId: terminalClaim.attemptId,
      leaseToken: terminalClaim.leaseToken,
      targetKey: "project:proj_ignored",
      status: "ignored",
      now: at(100)
    });
    await recordWebhookDeliveryTargetOutcome({
      deliveryId: terminalClaim.deliveryId,
      attemptId: terminalClaim.attemptId,
      leaseToken: terminalClaim.leaseToken,
      targetKey: "service:svc_completed",
      status: "completed",
      now: at(200)
    });

    const terminalReclaimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-terminal-ledger", {
          leaseToken: "lease-token-four",
          now: at(1_001)
        })
      )
    );
    await expect(
      listWebhookDeliveryRetryEligibleTargetKeys({
        deliveryId: terminalReclaimed.deliveryId,
        attemptId: terminalReclaimed.attemptId,
        leaseToken: terminalReclaimed.leaseToken,
        now: at(1_002)
      })
    ).resolves.toMatchObject({
      status: "active",
      targetKeys: [],
      targetSummary: {
        totalTargetCount: 2,
        terminalTargetCount: 2,
        failedTargetCount: 0,
        pendingTargetCount: 0
      }
    });

    expect(emptyClaim.deliveryId).not.toBe(terminalClaim.deliveryId);
    const persistedTargets = await db
      .select()
      .from(webhookDeliveryTargets)
      .where(eq(webhookDeliveryTargets.deliveryId, terminalClaim.deliveryId));
    expect(persistedTargets).toHaveLength(2);
  });

  it("refuses to mark a delivery successful while a discovered target remains pending", async () => {
    const claimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-unresolved-finalization", {
          targetKeys: ["service:svc_completed", "service:svc_pending"]
        })
      )
    );

    await completeWebhookDeliveryAttempt({
      deliveryId: claimed.deliveryId,
      attemptId: claimed.attemptId,
      leaseToken: claimed.leaseToken,
      outcome: "success",
      targetOutcomes: [{ targetKey: "service:svc_completed", status: "completed" }],
      now: at(100)
    });

    const [delivery] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, claimed.deliveryId));
    const [attempt] = await db
      .select()
      .from(webhookDeliveryAttempts)
      .where(eq(webhookDeliveryAttempts.id, claimed.attemptId));
    expect(delivery?.status).toBe("partial");
    expect(attempt?.status).toBe("partial");
  });
});
