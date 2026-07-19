import { and, asc, eq, inArray, isNull, lte, or } from "drizzle-orm";
import { db } from "../connection";
import {
  serverMetricAlerts,
  serverMetricOutbox,
  serverMetricPolicies
} from "../schema/server-metrics";
import { notificationChannels } from "../schema/notifications";
import { servers } from "../schema/servers";
import { newId } from "./json-helpers";
import { toServerMetricPolicy } from "./server-metric-policy";
import type {
  ServerMetricAlertTransition,
  ServerMetricTransitionEventType,
  ServerMetricTransitionType
} from "./server-metric-types";

const DEFAULT_LEASE_MS = 30_000;
const DEFAULT_MAX_ATTEMPTS = 8;
const DEFAULT_RETRY_BASE_MS = 1_000;
const DEFAULT_RETRY_MAX_MS = 5 * 60_000;

export type ServerMetricOutboxTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type ServerMetricOutboxStatus =
  "pending" | "retrying" | "sending" | "sent" | "suppressed" | "terminal-failure";

export interface ClaimedServerMetricOutboxDelivery {
  outboxId: string;
  alertId: string;
  serverId: string;
  channelId: string;
  serverName: string;
  teamId: string;
  cooldownMinutes: number;
  leaseOwner: string;
  leaseToken: string;
  leaseDurationMs: number;
  transition: ServerMetricAlertTransition;
}

export function getServerMetricOutboxRetryConfig() {
  const positive = (value: string | undefined, fallback: number) => {
    const parsed = Number.parseInt(value ?? "", 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback;
  };
  return {
    leaseDurationMs: positive(process.env.DAOFLOW_SERVER_METRIC_OUTBOX_LEASE_MS, DEFAULT_LEASE_MS),
    maxAttempts: positive(
      process.env.DAOFLOW_SERVER_METRIC_OUTBOX_MAX_ATTEMPTS,
      DEFAULT_MAX_ATTEMPTS
    ),
    baseDelayMs: positive(
      process.env.DAOFLOW_SERVER_METRIC_OUTBOX_RETRY_BASE_MS,
      DEFAULT_RETRY_BASE_MS
    ),
    maxDelayMs: positive(
      process.env.DAOFLOW_SERVER_METRIC_OUTBOX_RETRY_MAX_MS,
      DEFAULT_RETRY_MAX_MS
    )
  };
}

export function nextServerMetricOutboxRetryAt(
  attemptCount: number,
  now: Date,
  config = getServerMetricOutboxRetryConfig()
) {
  const delay = Math.min(
    config.maxDelayMs,
    config.baseDelayMs * 2 ** Math.max(0, attemptCount - 1)
  );
  return new Date(now.getTime() + delay);
}

function toTransition(alert: typeof serverMetricAlerts.$inferSelect): ServerMetricAlertTransition {
  return {
    metricKey: alert.metricKey as ServerMetricAlertTransition["metricKey"],
    eventType: alert.eventType as ServerMetricTransitionEventType,
    transitionType: alert.transitionType as ServerMetricTransitionType,
    previousState: alert.previousState as ServerMetricAlertTransition["previousState"],
    nextState: alert.nextState as ServerMetricAlertTransition["nextState"],
    measuredValue: alert.measuredValue,
    thresholdValue: alert.thresholdValue,
    occurredAt: alert.occurredAt
  };
}

export async function requireActiveServerMetricOutboxLease(
  tx: ServerMetricOutboxTransaction,
  input: { outboxId: string; leaseOwner?: string; leaseToken: string; now: Date }
) {
  const [outbox] = await tx
    .select()
    .from(serverMetricOutbox)
    .where(eq(serverMetricOutbox.id, input.outboxId))
    .limit(1)
    .for("update");
  if (
    !outbox ||
    outbox.status !== "sending" ||
    (input.leaseOwner !== undefined && outbox.leaseOwner !== input.leaseOwner) ||
    outbox.leaseToken !== input.leaseToken ||
    !outbox.leaseExpiresAt ||
    outbox.leaseExpiresAt.getTime() <= input.now.getTime()
  ) {
    return null;
  }
  return outbox;
}

/** Claims one due outbox record. Expired sending leases are reclaimed safely. */
export async function claimNextServerMetricOutbox(input: {
  owner: string;
  now: Date;
  leaseDurationMs?: number;
}): Promise<ClaimedServerMetricOutboxDelivery | null> {
  const token = newId();
  const leaseDurationMs =
    input.leaseDurationMs ?? getServerMetricOutboxRetryConfig().leaseDurationMs;
  const expiresAt = new Date(input.now.getTime() + leaseDurationMs);
  return db.transaction(async (tx) => {
    const [candidate] = await tx
      .select({
        outbox: serverMetricOutbox,
        alert: serverMetricAlerts,
        server: servers,
        policy: serverMetricPolicies
      })
      .from(serverMetricOutbox)
      .innerJoin(serverMetricAlerts, eq(serverMetricAlerts.id, serverMetricOutbox.alertId))
      .innerJoin(servers, eq(servers.id, serverMetricOutbox.serverId))
      .innerJoin(
        notificationChannels,
        and(
          eq(notificationChannels.id, serverMetricOutbox.channelId),
          eq(notificationChannels.teamId, servers.teamId)
        )
      )
      .leftJoin(
        serverMetricPolicies,
        eq(serverMetricPolicies.serverId, serverMetricOutbox.serverId)
      )
      .where(
        and(
          inArray(serverMetricOutbox.status, ["pending", "retrying", "sending"]),
          lte(serverMetricOutbox.nextAttemptAt, input.now),
          or(
            isNull(serverMetricOutbox.leaseExpiresAt),
            lte(serverMetricOutbox.leaseExpiresAt, input.now)
          )
        )
      )
      .orderBy(asc(serverMetricOutbox.nextAttemptAt), asc(serverMetricOutbox.createdAt))
      .limit(1)
      .for("update", { of: serverMetricOutbox, skipLocked: true });
    if (!candidate || !candidate.server.teamId) return null;

    const [claimed] = await tx
      .update(serverMetricOutbox)
      .set({
        status: "sending",
        attemptCount: candidate.outbox.attemptCount + 1,
        leaseOwner: input.owner,
        leaseToken: token,
        leaseExpiresAt: expiresAt,
        updatedAt: input.now
      })
      .where(eq(serverMetricOutbox.id, candidate.outbox.id))
      .returning();
    if (!claimed || !claimed.leaseToken) return null;
    return {
      outboxId: claimed.id,
      alertId: claimed.alertId,
      serverId: claimed.serverId,
      channelId: claimed.channelId,
      serverName: candidate.server.name,
      teamId: candidate.server.teamId,
      cooldownMinutes: toServerMetricPolicy(candidate.policy).cooldownMinutes,
      leaseOwner: input.owner,
      leaseToken: claimed.leaseToken,
      leaseDurationMs,
      transition: toTransition(candidate.alert)
    };
  });
}
