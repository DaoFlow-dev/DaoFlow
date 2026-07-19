import { and, eq, gt } from "drizzle-orm";
import { db } from "../connection";
import {
  serverMetricAlerts,
  serverMetricOutbox,
  serverMetricStates,
  serverMetrics
} from "../schema/server-metrics";
import { notificationChannels } from "../schema/notifications";
import { servers } from "../schema/servers";
import type { ServerMetricsSnapshot } from "../../worker/server-metrics-collector";
import { matchesNotificationChannelRouting } from "../../worker/temporal/activities/notification-channel-routing";
import { newId } from "./json-helpers";
import type { ServerMetricCollectionLease } from "./server-metric-lease";
import type { ServerMetricAlertTransition, ServerMetricState } from "./server-metric-types";

type ServerMetricTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export class ServerMetricCollectionLeaseLostError extends Error {
  constructor(serverId: string) {
    super(`Server metric collection lease was lost for ${serverId}.`);
    this.name = "ServerMetricCollectionLeaseLostError";
  }
}

export interface PersistServerMetricCollectionInput {
  lease: ServerMetricCollectionLease;
  snapshot: ServerMetricsSnapshot | null;
  state: Omit<ServerMetricState, "collectionGeneration">;
  transitions: ServerMetricAlertTransition[];
  now: Date;
}

function metricSampleValues(input: PersistServerMetricCollectionInput) {
  const snapshot = input.snapshot;
  if (!snapshot) return null;
  return {
    id: newId(),
    serverId: input.lease.serverId,
    cpuPercent: snapshot.cpuPercent,
    memoryUsedPercent: snapshot.memoryUsedPercent,
    memoryUsedGB: snapshot.memoryUsedGB,
    memoryTotalGB: snapshot.memoryTotalGB,
    diskUsedPercent: snapshot.diskUsedPercent,
    diskTotalGB: snapshot.diskTotalGB,
    networkInMB: snapshot.networkInMB,
    networkOutMB: snapshot.networkOutMB,
    dockerDiskUsedPercent: snapshot.dockerDiskUsedPercent,
    dockerDiskTotalGB: snapshot.dockerDiskTotalGB,
    collectedAt: input.now
  };
}

async function persistLeasedCollection(
  tx: ServerMetricTransaction,
  input: PersistServerMetricCollectionInput
) {
  const [state] = await tx
    .update(serverMetricStates)
    .set({
      currentState: input.state.currentState,
      metricStates: input.state.metricStates,
      lastCheckedAt: input.state.lastCheckedAt,
      lastCollectedAt: input.state.lastCollectedAt,
      lastUnreachableAt: input.state.lastUnreachableAt,
      lastTransitionAt: input.state.lastTransitionAt,
      lastAlertAt: input.state.lastAlertAt,
      collectionLeaseOwner: null,
      collectionLeaseToken: null,
      collectionLeaseExpiresAt: null,
      updatedAt: input.now
    })
    .where(
      and(
        eq(serverMetricStates.serverId, input.lease.serverId),
        eq(serverMetricStates.collectionGeneration, input.lease.generation),
        eq(serverMetricStates.collectionLeaseOwner, input.lease.owner),
        eq(serverMetricStates.collectionLeaseToken, input.lease.token),
        gt(serverMetricStates.collectionLeaseExpiresAt, input.now)
      )
    )
    .returning({ serverId: serverMetricStates.serverId });
  if (!state) throw new ServerMetricCollectionLeaseLostError(input.lease.serverId);

  const sample = metricSampleValues(input);
  if (sample) await tx.insert(serverMetrics).values(sample);
  if (input.transitions.length === 0) return 0;

  const alerts = input.transitions.map((transition) => ({
    id: newId(),
    serverId: input.lease.serverId,
    metricKey: transition.metricKey,
    eventType: transition.eventType,
    transitionType: transition.transitionType,
    previousState: transition.previousState,
    nextState: transition.nextState,
    measuredValue: transition.measuredValue,
    thresholdValue: transition.thresholdValue,
    occurredAt: transition.occurredAt,
    notifiedAt: null
  }));
  await tx.insert(serverMetricAlerts).values(alerts);
  const [server] = await tx
    .select({ teamId: servers.teamId })
    .from(servers)
    .where(eq(servers.id, input.lease.serverId))
    .limit(1);
  if (!server?.teamId) return alerts.length;

  const channels = await tx
    .select({
      id: notificationChannels.id,
      eventSelectors: notificationChannels.eventSelectors,
      projectFilter: notificationChannels.projectFilter,
      environmentFilter: notificationChannels.environmentFilter
    })
    .from(notificationChannels)
    .where(
      and(eq(notificationChannels.teamId, server.teamId), eq(notificationChannels.enabled, true))
    );
  const deliveries = alerts.flatMap((alert) =>
    channels
      .filter((channel) =>
        matchesNotificationChannelRouting(channel, {
          eventType: alert.eventType
        })
      )
      .map((channel) => ({
        id: newId(),
        alertId: alert.id,
        serverId: alert.serverId,
        channelId: channel.id,
        metricKey: alert.metricKey,
        eventType: alert.eventType,
        status: "pending" as const,
        attemptCount: 0,
        nextAttemptAt: input.now,
        createdAt: input.now,
        updatedAt: input.now
      }))
  );
  if (deliveries.length > 0) await tx.insert(serverMetricOutbox).values(deliveries);
  return alerts.length;
}

/**
 * Writes the lease-guarded state, sample, immutable alert evidence, and
 * retryable outbox records in one transaction. Retention must run afterward.
 */
export async function persistServerMetricCollection(input: PersistServerMetricCollectionInput) {
  return db.transaction((tx) => persistLeasedCollection(tx, input));
}
