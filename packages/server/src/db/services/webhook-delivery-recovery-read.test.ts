import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { environments, projects } from "../schema/projects";
import { services } from "../schema/services";
import { teams } from "../schema/teams";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import {
  beginWebhookDeliveryTarget,
  claimWebhookDeliveryRecovery
} from "./webhook-delivery-recovery";
import { listWebhookDeliveryRecoveryForTeam } from "./webhook-delivery-recovery-read";

describe("webhook delivery recovery operator reads", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("returns only deliveries with targets owned by the requested team", async () => {
    await db.insert(teams).values({
      id: "team_webhook_other",
      name: "Webhook Other",
      slug: "webhook-other"
    });
    await db.insert(projects).values({
      id: "proj_webhook_foundation",
      name: "Foundation Webhook Project",
      teamId: "team_foundation"
    });
    await db.insert(projects).values({
      id: "proj_webhook_other",
      name: "Other Webhook Project",
      teamId: "team_webhook_other"
    });
    await db.insert(environments).values({
      id: "env_webhook_other",
      name: "Production",
      slug: "production",
      projectId: "proj_webhook_other"
    });
    await db.insert(services).values({
      id: "svc_webhook_other",
      name: "Other Webhook Service",
      slug: "other-webhook-service",
      projectId: "proj_webhook_other",
      environmentId: "env_webhook_other"
    });

    const foundation = await claimWebhookDeliveryRecovery({
      providerType: "github",
      eventType: "push",
      deliveryKey: "delivery-foundation-team",
      rawBody: '{"team":"foundation"}',
      leaseToken: "foundation-lease"
    });
    const other = await claimWebhookDeliveryRecovery({
      providerType: "gitlab",
      eventType: "push",
      deliveryKey: "delivery-other-team",
      rawBody: '{"team":"other"}',
      leaseToken: "other-lease"
    });
    if (foundation.kind !== "new" || other.kind !== "new") {
      throw new Error("Expected new webhook delivery claims.");
    }

    await beginWebhookDeliveryTarget({
      deliveryId: foundation.deliveryId,
      attemptId: foundation.attemptId,
      leaseToken: foundation.leaseToken,
      targetKey: "project:proj_webhook_foundation"
    });
    await beginWebhookDeliveryTarget({
      deliveryId: other.deliveryId,
      attemptId: other.attemptId,
      leaseToken: other.leaseToken,
      targetKey: "service:svc_webhook_other"
    });

    const foundationRows = await listWebhookDeliveryRecoveryForTeam({
      teamId: "team_foundation"
    });
    const otherRows = await listWebhookDeliveryRecoveryForTeam({
      teamId: "team_webhook_other"
    });

    expect(foundationRows.map((delivery) => delivery.id)).toEqual([foundation.deliveryId]);
    expect(foundationRows[0]?.targets.map((target) => target.targetKey)).toEqual([
      "project:proj_webhook_foundation"
    ]);
    expect(otherRows.map((delivery) => delivery.id)).toEqual([other.deliveryId]);
    expect(otherRows[0]?.targets.map((target) => target.targetKey)).toEqual([
      "service:svc_webhook_other"
    ]);
  });
});
