import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { webhookDeliveries, webhookDeliveryAttempts } from "../schema/webhook-deliveries";
import { resetTestDatabase } from "../../test-db";
import {
  claimWebhookDeliveryRecovery,
  completeWebhookDeliveryAttempt,
  hashWebhookDeliveryBody,
  renewWebhookDeliveryLease,
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
    rawBody: '{"ref":"refs/heads/main","marker":"super-secret-payload"}',
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

describe("webhook delivery recovery", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("claims a new delivery with a body digest and safe operator fields", async () => {
    const rawBody = '{"ref":"refs/heads/main","marker":"super-secret-payload"}';
    const result = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-first-claim", {
          rawBody,
          deliveryId: "github-provider-delivery-1",
          repoFullName: "DaoFlow-dev/DaoFlow",
          externalInstallationId: "123456",
          commitSha: "f".repeat(40),
          metadata: {
            branch: "main",
            changedPaths: ["apps/server/src/index.ts"],
            trigger: "push",
            body: "super-secret-payload",
            signature: "sha256=should-never-persist"
          },
          targetKeys: ["project:proj_foundation", "service:svc_foundation"]
        })
      )
    );

    expect(result.kind).toBe("new");
    expect(result.attemptId.length).toBeLessThanOrEqual(32);
    expect(result.deliveryId.length).toBeLessThanOrEqual(32);

    const [delivery] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, result.deliveryId));
    expect(delivery).toMatchObject({
      providerType: "github",
      eventType: "push",
      deliveryKey: "github-first-claim",
      deliveryId: "github-provider-delivery-1",
      repoFullName: "DaoFlow-dev/DaoFlow",
      externalInstallationId: "123456",
      commitSha: "f".repeat(40),
      bodyDigest: hashWebhookDeliveryBody(rawBody),
      status: "processing",
      attemptCount: 1,
      metadata: {
        branch: "main",
        changedPaths: ["apps/server/src/index.ts"],
        trigger: "push"
      }
    });
    expect(JSON.stringify(delivery)).not.toContain("super-secret-payload");
    expect(JSON.stringify(delivery)).not.toContain("should-never-persist");

    const [attempt] = await db
      .select()
      .from(webhookDeliveryAttempts)
      .where(eq(webhookDeliveryAttempts.id, result.attemptId));
    expect(attempt).toMatchObject({
      deliveryId: result.deliveryId,
      attemptNumber: 1,
      status: "processing",
      leaseOwner: "lease-token-one"
    });
  });

  it("returns a terminal duplicate after success without creating another attempt", async () => {
    const claimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(claimInput("github-duplicate-success"))
    );

    await expect(
      completeWebhookDeliveryAttempt({
        deliveryId: claimed.deliveryId,
        attemptId: claimed.attemptId,
        leaseToken: claimed.leaseToken,
        outcome: "success",
        now: at(100)
      })
    ).resolves.toMatchObject({ status: "completed" });

    await expect(
      claimWebhookDeliveryRecovery(
        claimInput("github-duplicate-success", { leaseToken: "lease-token-two", now: at(200) })
      )
    ).resolves.toMatchObject({
      kind: "terminal_duplicate",
      deliveryId: claimed.deliveryId,
      attemptId: claimed.attemptId,
      leaseToken: null,
      terminalStatus: "succeeded"
    });

    const attempts = await db
      .select()
      .from(webhookDeliveryAttempts)
      .where(eq(webhookDeliveryAttempts.deliveryId, claimed.deliveryId));
    expect(attempts).toHaveLength(1);
  });

  it("acknowledges a live lease and allows its owner to renew it", async () => {
    const claimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-live-lease", { leaseDurationMs: 1_000 })
      )
    );

    await expect(
      renewWebhookDeliveryLease({
        deliveryId: claimed.deliveryId,
        attemptId: claimed.attemptId,
        leaseToken: claimed.leaseToken,
        leaseDurationMs: 5_000,
        now: at(500)
      })
    ).resolves.toMatchObject({ status: "renewed", leaseExpiresAt: at(5_500) });

    await expect(
      claimWebhookDeliveryRecovery(
        claimInput("github-live-lease", { leaseToken: "lease-token-two", now: at(1_100) })
      )
    ).resolves.toMatchObject({
      kind: "live_duplicate",
      deliveryId: claimed.deliveryId,
      attemptId: claimed.attemptId,
      leaseToken: null,
      leaseExpiresAt: at(5_500)
    });
  });

  it("serializes simultaneous claims so only one request owns the live lease", async () => {
    const [first, second] = await Promise.all([
      claimWebhookDeliveryRecovery(
        claimInput("github-simultaneous-claim", { leaseToken: "lease-concurrent-one" })
      ),
      claimWebhookDeliveryRecovery(
        claimInput("github-simultaneous-claim", { leaseToken: "lease-concurrent-two" })
      )
    ]);

    expect([first.kind, second.kind].sort()).toEqual(["live_duplicate", "new"]);
    const deliveryId = first.deliveryId;
    const attempts = await db
      .select()
      .from(webhookDeliveryAttempts)
      .where(eq(webhookDeliveryAttempts.deliveryId, deliveryId));
    expect(attempts).toHaveLength(1);
  });

  it("reclaims an expired processing attempt and marks its original attempt expired", async () => {
    const claimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-expired-reclaim", { leaseDurationMs: 1_000 })
      )
    );

    const reclaimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-expired-reclaim", {
          leaseToken: "lease-token-two",
          now: at(1_001)
        })
      )
    );

    expect(reclaimed.kind).toBe("reclaimed");
    const attempts = await db
      .select()
      .from(webhookDeliveryAttempts)
      .where(eq(webhookDeliveryAttempts.deliveryId, claimed.deliveryId))
      .orderBy(asc(webhookDeliveryAttempts.attemptNumber));
    expect(attempts).toMatchObject([
      { id: claimed.attemptId, attemptNumber: 1, status: "expired" },
      { id: reclaimed.attemptId, attemptNumber: 2, status: "processing" }
    ]);
  });

  it("reclaims a failed attempt and persists only redacted failure details", async () => {
    const claimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(claimInput("github-failed-reclaim"))
    );

    await expect(
      completeWebhookDeliveryAttempt({
        deliveryId: claimed.deliveryId,
        attemptId: claimed.attemptId,
        leaseToken: claimed.leaseToken,
        outcome: "failed",
        detail: "Provider response access_token=glpat-abcdefghijklmno",
        errorSummary: "Authorization: Bearer ghp_abcdefghijklmnop",
        now: at(100)
      })
    ).resolves.toMatchObject({ status: "completed" });

    const reclaimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-failed-reclaim", { leaseToken: "lease-token-two", now: at(200) })
      )
    );
    expect(reclaimed.kind).toBe("reclaimed");

    const [failedAttempt] = await db
      .select()
      .from(webhookDeliveryAttempts)
      .where(eq(webhookDeliveryAttempts.id, claimed.attemptId));
    expect(failedAttempt?.errorSummary).toContain("[redacted]");
    expect(failedAttempt?.errorSummary).not.toContain("ghp_abcdefghijklmnop");
    expect(failedAttempt?.errorSummary).not.toContain("glpat-abcdefghijklmno");
  });

  it("rejects a delivery key that has a different body digest", async () => {
    const claimed = requireOwnedLease(
      await claimWebhookDeliveryRecovery(
        claimInput("github-body-collision", { rawBody: '{"payload":"first"}' })
      )
    );

    await expect(
      claimWebhookDeliveryRecovery(
        claimInput("github-body-collision", {
          rawBody: '{"payload":"second"}',
          leaseToken: "lease-token-two",
          now: at(100)
        })
      )
    ).resolves.toMatchObject({
      kind: "body_digest_collision",
      deliveryId: claimed.deliveryId,
      attemptId: null,
      leaseToken: null
    });

    const attempts = await db
      .select()
      .from(webhookDeliveryAttempts)
      .where(eq(webhookDeliveryAttempts.deliveryId, claimed.deliveryId));
    expect(attempts).toHaveLength(1);
  });
});
