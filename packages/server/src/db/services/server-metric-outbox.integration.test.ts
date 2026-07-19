import { asc, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { notificationChannels } from "../schema/notifications";
import { teams } from "../schema/teams";
import { serverMetricAlerts, serverMetricOutbox } from "../schema/server-metrics";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import { persistServerMetricCollection } from "./server-metric-collection-persistence";
import { claimServerMetricCollection } from "./server-metric-lease";
import { claimNextServerMetricOutbox } from "./server-metric-outbox";
import {
  claimServerMetricOutboxCooldown,
  markServerMetricOutboxFailure,
  markServerMetricOutboxSent,
  renewServerMetricOutboxDeliveryLease
} from "./server-metric-outbox-delivery";
import type { ServerMetricAlertTransition, ServerMetricState } from "./server-metric-types";

const now = new Date("2026-07-18T12:00:00.000Z");
const serverId = "srv_foundation_1";
const teamId = "team_foundation";

function hardTransition(): ServerMetricAlertTransition {
  return {
    metricKey: "cpu",
    eventType: "server.metrics.hard",
    transitionType: "transition",
    previousState: "warning",
    nextState: "hard",
    measuredValue: 95,
    thresholdValue: 90,
    occurredAt: now
  };
}

function hardState(): Omit<ServerMetricState, "collectionGeneration"> {
  return {
    currentState: "hard",
    metricStates: { cpu: "hard" },
    lastCheckedAt: now,
    lastCollectedAt: now,
    lastUnreachableAt: null,
    lastTransitionAt: now,
    lastAlertAt: null
  };
}

async function createChannel(input: {
  id: string;
  teamId?: string;
  selectors: string[];
  enabled?: boolean;
  projectFilter?: string | null;
  environmentFilter?: string | null;
}) {
  await db.insert(notificationChannels).values({
    id: input.id,
    teamId: input.teamId ?? teamId,
    name: input.id,
    channelType: "generic_webhook",
    webhookUrl: `https://example.invalid/${input.id}`,
    eventSelectors: input.selectors,
    enabled: input.enabled ?? true,
    projectFilter: input.projectFilter ?? null,
    environmentFilter: input.environmentFilter ?? null,
    createdAt: now,
    updatedAt: now
  });
}

async function persistHardTransition() {
  const lease = await claimServerMetricCollection({
    serverId,
    expectedGeneration: 0,
    owner: "metric-integration-test",
    now
  });
  if (!lease) throw new Error("Expected a collection lease for the seeded server.");

  await persistServerMetricCollection({
    lease,
    snapshot: null,
    state: hardState(),
    transitions: [hardTransition()],
    now
  });
}

describe("server metric outbox PostgreSQL integration", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("claims an outbox row when its optional policy row is absent", async () => {
    await createChannel({
      id: "metric_claim_channel",
      selectors: ["server.metrics.hard"]
    });
    await db.insert(serverMetricAlerts).values({
      id: "metric_claim_alert",
      serverId,
      metricKey: "cpu",
      eventType: "server.metrics.hard",
      transitionType: "transition",
      previousState: "warning",
      nextState: "hard",
      measuredValue: 95,
      thresholdValue: 90,
      occurredAt: now,
      notifiedAt: null
    });
    await db.insert(serverMetricOutbox).values({
      id: "metric_claim_outbox",
      alertId: "metric_claim_alert",
      serverId,
      channelId: "metric_claim_channel",
      metricKey: "cpu",
      eventType: "server.metrics.hard",
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now
    });

    const claimed = await claimNextServerMetricOutbox({ owner: "replica-a", now });

    expect(claimed).toMatchObject({
      outboxId: "metric_claim_outbox",
      channelId: "metric_claim_channel",
      teamId
    });
    const [stored] = await db
      .select({ status: serverMetricOutbox.status, attemptCount: serverMetricOutbox.attemptCount })
      .from(serverMetricOutbox)
      .where(eq(serverMetricOutbox.id, "metric_claim_outbox"));
    expect(stored).toEqual({ status: "sending", attemptCount: 1 });
  });

  it("renews an active delivery so another worker cannot reclaim it mid-send", async () => {
    await createChannel({
      id: "metric_slow_channel",
      selectors: ["server.metrics.hard"]
    });
    await db.insert(serverMetricAlerts).values({
      id: "metric_slow_alert",
      serverId,
      metricKey: "cpu",
      eventType: "server.metrics.hard",
      transitionType: "transition",
      previousState: "warning",
      nextState: "hard",
      measuredValue: 95,
      thresholdValue: 90,
      occurredAt: now,
      notifiedAt: null
    });
    await db.insert(serverMetricOutbox).values({
      id: "metric_slow_outbox",
      alertId: "metric_slow_alert",
      serverId,
      channelId: "metric_slow_channel",
      metricKey: "cpu",
      eventType: "server.metrics.hard",
      status: "pending",
      attemptCount: 0,
      nextAttemptAt: now,
      createdAt: now,
      updatedAt: now
    });

    const first = await claimNextServerMetricOutbox({
      owner: "replica-a",
      now,
      leaseDurationMs: 30_000
    });
    expect(first).not.toBeNull();
    if (!first) throw new Error("Expected the slow delivery to be claimed.");
    expect(await claimServerMetricOutboxCooldown({ delivery: first, now })).toBe("deliver");

    const renewedAt = new Date(now.getTime() + 10_000);
    expect(await renewServerMetricOutboxDeliveryLease({ delivery: first, now: renewedAt })).toBe(
      true
    );
    expect(
      await claimNextServerMetricOutbox({
        owner: "replica-b",
        now: new Date(now.getTime() + 30_001),
        leaseDurationMs: 30_000
      })
    ).toBeNull();

    const reclaimed = await claimNextServerMetricOutbox({
      owner: "replica-b",
      now: new Date(now.getTime() + 40_001),
      leaseDurationMs: 30_000
    });
    expect(reclaimed).toMatchObject({ outboxId: first.outboxId, leaseOwner: "replica-b" });
  });

  it("creates independent matching channel deliveries, so a retry cannot suppress a sent peer", async () => {
    await db.insert(teams).values({
      id: "team_metric_other",
      name: "Other metric team",
      slug: "other-metric-team",
      status: "active",
      createdAt: now,
      updatedAt: now
    });
    await Promise.all([
      createChannel({ id: "metric_channel_a", selectors: ["server.metrics.hard"] }),
      createChannel({ id: "metric_channel_b", selectors: ["server.metrics.*"] }),
      createChannel({
        id: "metric_channel_disabled",
        selectors: ["server.metrics.hard"],
        enabled: false
      }),
      createChannel({
        id: "metric_channel_filtered",
        selectors: ["*"],
        projectFilter: "project-a"
      }),
      createChannel({
        id: "metric_channel_other_team",
        teamId: "team_metric_other",
        selectors: ["*"]
      })
    ]);

    await persistHardTransition();

    const queued = await db
      .select({ channelId: serverMetricOutbox.channelId })
      .from(serverMetricOutbox)
      .orderBy(asc(serverMetricOutbox.channelId));
    expect(queued).toEqual([{ channelId: "metric_channel_a" }, { channelId: "metric_channel_b" }]);

    const first = await claimNextServerMetricOutbox({ owner: "replica-a", now });
    expect(first).not.toBeNull();
    if (!first) throw new Error("Expected the first matching channel delivery.");
    expect(await claimServerMetricOutboxCooldown({ delivery: first, now })).toBe("deliver");
    await markServerMetricOutboxSent({ delivery: first, now });

    const second = await claimNextServerMetricOutbox({ owner: "replica-b", now });
    expect(second).not.toBeNull();
    if (!second) throw new Error("Expected the second matching channel delivery.");
    expect(second.channelId).not.toBe(first.channelId);
    expect(await claimServerMetricOutboxCooldown({ delivery: second, now })).toBe("deliver");
    await markServerMetricOutboxFailure({
      delivery: second,
      error: new Error("channel unavailable"),
      now,
      retryConfig: {
        leaseDurationMs: 30_000,
        maxAttempts: 3,
        baseDelayMs: 1_000,
        maxDelayMs: 4_000
      }
    });

    const statuses = await db
      .select({ channelId: serverMetricOutbox.channelId, status: serverMetricOutbox.status })
      .from(serverMetricOutbox)
      .orderBy(asc(serverMetricOutbox.channelId));
    expect(statuses).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ channelId: first.channelId, status: "sent" }),
        expect.objectContaining({ channelId: second.channelId, status: "retrying" })
      ])
    );
  });

  it("keeps immutable alert evidence when no matching delivery channel is configured", async () => {
    await persistHardTransition();

    const [alerts, deliveries] = await Promise.all([
      db.select().from(serverMetricAlerts).where(eq(serverMetricAlerts.serverId, serverId)),
      db.select().from(serverMetricOutbox).where(eq(serverMetricOutbox.serverId, serverId))
    ]);
    expect(alerts).toHaveLength(1);
    expect(alerts[0]).toMatchObject({ eventType: "server.metrics.hard", notifiedAt: null });
    expect(deliveries).toEqual([]);
  });
});
