import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import {
  serverMetricAlerts,
  serverMetricDeliveryCooldowns,
  serverMetricOutbox,
  serverMetricStates
} from "../schema/server-metrics";
import {
  getServerMetricOutboxRetryConfig,
  nextServerMetricOutboxRetryAt,
  requireActiveServerMetricOutboxLease,
  type ClaimedServerMetricOutboxDelivery,
  type ServerMetricOutboxStatus
} from "./server-metric-outbox";

const MAX_ERROR_LENGTH = 1_000;

function safeErrorMessage(error: unknown) {
  const value = error instanceof Error ? error.message : String(error);
  return value.slice(0, MAX_ERROR_LENGTH);
}

function cooldownKey(outbox: typeof serverMetricOutbox.$inferSelect) {
  return and(
    eq(serverMetricDeliveryCooldowns.serverId, outbox.serverId),
    eq(serverMetricDeliveryCooldowns.channelId, outbox.channelId),
    eq(serverMetricDeliveryCooldowns.metricKey, outbox.metricKey),
    eq(serverMetricDeliveryCooldowns.eventType, outbox.eventType)
  );
}

export function decideServerMetricOutboxCooldown(input: {
  now: Date;
  cooldownMinutes: number;
  lastDeliveredAt: Date | null;
  activeLeaseToken: string | null;
  activeLeaseExpiresAt: Date | null;
  deliveryLeaseToken: string;
}): "deliver" | "suppressed" | "busy" {
  if (
    input.cooldownMinutes > 0 &&
    input.lastDeliveredAt !== null &&
    input.now.getTime() - input.lastDeliveredAt.getTime() < input.cooldownMinutes * 60_000
  ) {
    return "suppressed";
  }
  if (
    input.activeLeaseExpiresAt !== null &&
    input.activeLeaseExpiresAt.getTime() > input.now.getTime() &&
    input.activeLeaseToken !== input.deliveryLeaseToken
  ) {
    return "busy";
  }
  return "deliver";
}

export function resolveServerMetricOutboxFailure(input: {
  attemptCount: number;
  maxAttempts: number;
  now: Date;
  error: unknown;
  retryConfig: ReturnType<typeof getServerMetricOutboxRetryConfig>;
}): {
  status: Extract<ServerMetricOutboxStatus, "retrying" | "terminal-failure">;
  nextAttemptAt: Date;
  lastError: string;
  terminalFailedAt: Date | null;
} {
  const terminal = input.attemptCount >= input.maxAttempts;
  return {
    status: terminal ? "terminal-failure" : "retrying",
    nextAttemptAt: terminal
      ? input.now
      : nextServerMetricOutboxRetryAt(input.attemptCount, input.now, input.retryConfig),
    lastError: safeErrorMessage(input.error),
    terminalFailedAt: terminal ? input.now : null
  };
}

/** Applies per-metric/event cooldown after an outbox row is leased. */
export async function claimServerMetricOutboxCooldown(input: {
  delivery: ClaimedServerMetricOutboxDelivery;
  now: Date;
}): Promise<"deliver" | "suppressed" | "busy" | "lost"> {
  return db.transaction(async (tx) => {
    const outbox = await requireActiveServerMetricOutboxLease(tx, {
      outboxId: input.delivery.outboxId,
      leaseOwner: input.delivery.leaseOwner,
      leaseToken: input.delivery.leaseToken,
      now: input.now
    });
    if (!outbox) return "lost";
    const leaseToken = outbox.leaseToken;
    if (!leaseToken) return "lost";
    await tx
      .insert(serverMetricDeliveryCooldowns)
      .values({
        serverId: outbox.serverId,
        channelId: outbox.channelId,
        metricKey: outbox.metricKey,
        eventType: outbox.eventType,
        updatedAt: input.now
      })
      .onConflictDoNothing();
    const [cooldown] = await tx
      .select()
      .from(serverMetricDeliveryCooldowns)
      .where(cooldownKey(outbox))
      .limit(1)
      .for("update");
    if (!cooldown) return "lost";

    const decision = decideServerMetricOutboxCooldown({
      now: input.now,
      cooldownMinutes: input.delivery.cooldownMinutes,
      lastDeliveredAt: cooldown.lastDeliveredAt,
      activeLeaseToken: cooldown.deliveryLeaseToken,
      activeLeaseExpiresAt: cooldown.deliveryLeaseExpiresAt,
      deliveryLeaseToken: leaseToken
    });
    if (decision === "suppressed") {
      await tx
        .update(serverMetricOutbox)
        .set({
          status: "suppressed",
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          suppressedAt: input.now,
          updatedAt: input.now
        })
        .where(eq(serverMetricOutbox.id, outbox.id));
      return "suppressed";
    }

    if (decision === "busy") {
      const retryAt = cooldown.deliveryLeaseExpiresAt;
      if (!retryAt) return "lost";
      await tx
        .update(serverMetricOutbox)
        .set({
          status: "retrying",
          leaseOwner: null,
          leaseToken: null,
          leaseExpiresAt: null,
          nextAttemptAt: retryAt,
          updatedAt: input.now
        })
        .where(eq(serverMetricOutbox.id, outbox.id));
      return "busy";
    }

    await tx
      .update(serverMetricDeliveryCooldowns)
      .set({
        deliveryLeaseToken: outbox.leaseToken,
        deliveryLeaseExpiresAt: outbox.leaseExpiresAt,
        updatedAt: input.now
      })
      .where(cooldownKey(outbox));
    return "deliver";
  });
}

/**
 * Extends both leases that protect an in-flight notification. A failed renewal
 * means the caller no longer has a safe claim to complete the delivery.
 */
export async function renewServerMetricOutboxDeliveryLease(input: {
  delivery: ClaimedServerMetricOutboxDelivery;
  now: Date;
}): Promise<boolean> {
  const expiresAt = new Date(input.now.getTime() + input.delivery.leaseDurationMs);
  return db.transaction(async (tx) => {
    const outbox = await requireActiveServerMetricOutboxLease(tx, {
      outboxId: input.delivery.outboxId,
      leaseOwner: input.delivery.leaseOwner,
      leaseToken: input.delivery.leaseToken,
      now: input.now
    });
    if (!outbox) return false;
    const [cooldown] = await tx
      .select()
      .from(serverMetricDeliveryCooldowns)
      .where(cooldownKey(outbox))
      .limit(1)
      .for("update");
    if (!cooldown || cooldown.deliveryLeaseToken !== input.delivery.leaseToken) return false;

    const [renewedOutbox] = await tx
      .update(serverMetricOutbox)
      .set({ leaseExpiresAt: expiresAt, updatedAt: input.now })
      .where(
        and(
          eq(serverMetricOutbox.id, outbox.id),
          eq(serverMetricOutbox.leaseOwner, input.delivery.leaseOwner),
          eq(serverMetricOutbox.leaseToken, input.delivery.leaseToken)
        )
      )
      .returning({ id: serverMetricOutbox.id });
    const [renewedCooldown] = await tx
      .update(serverMetricDeliveryCooldowns)
      .set({ deliveryLeaseExpiresAt: expiresAt, updatedAt: input.now })
      .where(
        and(
          cooldownKey(outbox),
          eq(serverMetricDeliveryCooldowns.deliveryLeaseToken, input.delivery.leaseToken)
        )
      )
      .returning({ serverId: serverMetricDeliveryCooldowns.serverId });
    if (!renewedOutbox || !renewedCooldown) {
      throw new Error("Server metric outbox lease changed during renewal.");
    }
    return true;
  });
}

export async function markServerMetricOutboxSent(input: {
  delivery: ClaimedServerMetricOutboxDelivery;
  now: Date;
}) {
  return db.transaction(async (tx) => {
    const outbox = await requireActiveServerMetricOutboxLease(tx, {
      outboxId: input.delivery.outboxId,
      leaseOwner: input.delivery.leaseOwner,
      leaseToken: input.delivery.leaseToken,
      now: input.now
    });
    if (!outbox) return null;
    const [cooldown] = await tx
      .select()
      .from(serverMetricDeliveryCooldowns)
      .where(cooldownKey(outbox))
      .limit(1)
      .for("update");
    if (!cooldown || cooldown.deliveryLeaseToken !== outbox.leaseToken) return null;

    const [updated] = await tx
      .update(serverMetricOutbox)
      .set({
        status: "sent",
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        lastError: null,
        sentAt: input.now,
        updatedAt: input.now
      })
      .where(eq(serverMetricOutbox.id, outbox.id))
      .returning();
    if (!updated) return null;
    await tx
      .update(serverMetricAlerts)
      .set({ notifiedAt: input.now })
      .where(eq(serverMetricAlerts.id, outbox.alertId));
    await tx
      .update(serverMetricStates)
      .set({ lastAlertAt: input.now, updatedAt: input.now })
      .where(eq(serverMetricStates.serverId, outbox.serverId));
    await tx
      .update(serverMetricDeliveryCooldowns)
      .set({
        lastDeliveredAt: input.now,
        deliveryLeaseToken: null,
        deliveryLeaseExpiresAt: null,
        updatedAt: input.now
      })
      .where(cooldownKey(outbox));
    return updated;
  });
}

export async function markServerMetricOutboxFailure(input: {
  delivery: ClaimedServerMetricOutboxDelivery;
  error: unknown;
  now: Date;
  maxAttempts?: number;
  retryConfig?: ReturnType<typeof getServerMetricOutboxRetryConfig>;
}) {
  return db.transaction(async (tx) => {
    const outbox = await requireActiveServerMetricOutboxLease(tx, {
      outboxId: input.delivery.outboxId,
      leaseOwner: input.delivery.leaseOwner,
      leaseToken: input.delivery.leaseToken,
      now: input.now
    });
    if (!outbox) return null;
    const config = input.retryConfig ?? getServerMetricOutboxRetryConfig();
    const outcome = resolveServerMetricOutboxFailure({
      attemptCount: outbox.attemptCount,
      maxAttempts: input.maxAttempts ?? config.maxAttempts,
      now: input.now,
      error: input.error,
      retryConfig: config
    });
    const [updated] = await tx
      .update(serverMetricOutbox)
      .set({
        status: outcome.status,
        leaseOwner: null,
        leaseToken: null,
        leaseExpiresAt: null,
        nextAttemptAt: outcome.nextAttemptAt,
        lastError: outcome.lastError,
        terminalFailedAt: outcome.terminalFailedAt,
        updatedAt: input.now
      })
      .where(eq(serverMetricOutbox.id, outbox.id))
      .returning();
    if (!updated) return null;
    await tx
      .update(serverMetricDeliveryCooldowns)
      .set({
        deliveryLeaseToken: null,
        deliveryLeaseExpiresAt: null,
        updatedAt: input.now
      })
      .where(
        and(
          cooldownKey(outbox),
          eq(serverMetricDeliveryCooldowns.deliveryLeaseToken, input.delivery.leaseToken)
        )
      );
    return updated;
  });
}
