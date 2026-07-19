import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { webhookDeliveries } from "../schema/webhook-deliveries";
import { resetTestDatabase } from "../../test-db";
import { claimWebhookDeliveryRecovery, hashWebhookDeliveryBody } from "./webhook-delivery-recovery";

const RAW_BODY = '{"ref":"refs/heads/main","marker":"super-secret-payload"}';

describe("legacy webhook delivery recovery", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("keeps a successful NULL-digest historical row as a legacy duplicate", async () => {
    const legacyId = "legacy_webhook_delivery_00000001";
    await db.insert(webhookDeliveries).values({
      id: legacyId,
      providerType: "github",
      eventType: "push",
      deliveryKey: "github-legacy-row",
      status: "queued",
      metadata: { branch: "main" }
    });

    await expect(
      claimWebhookDeliveryRecovery({
        providerType: "github",
        eventType: "push",
        deliveryKey: "github-legacy-row",
        rawBody: RAW_BODY,
        leaseToken: "lease-token-two"
      })
    ).resolves.toMatchObject({
      kind: "terminal_duplicate",
      deliveryId: legacyId,
      attemptId: null,
      leaseToken: null,
      terminalStatus: "legacy"
    });

    const [legacy] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, legacyId));
    expect(legacy?.bodyDigest).toBeNull();
    expect(legacy?.attemptCount).toBe(0);
  });

  it("adopts a digest and reclaims a failed NULL-digest historical row", async () => {
    const legacyId = "legacy_webhook_delivery_00000002";
    await db.insert(webhookDeliveries).values({
      id: legacyId,
      providerType: "github",
      eventType: "push",
      deliveryKey: "github-legacy-failed-row",
      status: "failed",
      metadata: { branch: "main" }
    });

    await expect(
      claimWebhookDeliveryRecovery({
        providerType: "github",
        eventType: "push",
        deliveryKey: "github-legacy-failed-row",
        rawBody: RAW_BODY,
        leaseToken: "lease-token-two"
      })
    ).resolves.toMatchObject({ kind: "reclaimed", deliveryId: legacyId });

    const [legacy] = await db
      .select()
      .from(webhookDeliveries)
      .where(eq(webhookDeliveries.id, legacyId));
    expect(legacy?.bodyDigest).toBe(hashWebhookDeliveryBody(RAW_BODY));
    expect(legacy?.attemptCount).toBe(1);
  });
});
