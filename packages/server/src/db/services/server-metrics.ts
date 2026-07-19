import { and, asc, desc, eq, gte, isNotNull, isNull, lt, lte, or, sql } from "drizzle-orm";
import { db } from "../connection";
import {
  serverMetricAlerts,
  serverMetricPolicies,
  serverMetricStates,
  serverMetrics
} from "../schema/server-metrics";
import { servers } from "../schema/servers";
import { newId } from "./json-helpers";
import {
  DEFAULT_SERVER_METRIC_POLICY,
  getServerMetricPolicy,
  toServerMetricPolicy,
  type ServerMetricPolicy
} from "./server-metric-policy";
import {
  getServerMetricState,
  listServerMetricAlerts,
  toServerMetricState
} from "./server-metric-state";
import type { ServerMetricState } from "./server-metric-types";
import type { ServerMetricsSnapshot } from "../../worker/server-metrics-collector";

export interface ServerMetricMonitoringCandidate {
  server: typeof servers.$inferSelect;
  policy: ServerMetricPolicy;
  state: ServerMetricState;
}

/**
 * Public read-model contract. Runtime results always include the complete
 * policy, while this boundary stays additive for independently released UI
 * and CLI consumers.
 */
export interface ServerMetricMonitoringResult {
  serverId: string;
  policy: Partial<ServerMetricPolicy>;
  state: {
    currentState: string;
    metricStates: object;
    lastCheckedAt: Date | null;
    lastCollectedAt: Date | null;
    lastUnreachableAt: Date | null;
    lastTransitionAt: Date | null;
    lastAlertAt: Date | null;
  };
  latest: typeof serverMetrics.$inferSelect | null;
  history: Array<typeof serverMetrics.$inferSelect>;
  alerts: Array<typeof serverMetricAlerts.$inferSelect>;
}

export async function insertServerMetrics(
  serverId: string,
  snapshot: ServerMetricsSnapshot,
  collectedAt = new Date()
) {
  await db.insert(serverMetrics).values({
    id: newId(),
    serverId,
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
    collectedAt
  });
}

export async function getLatestServerMetrics(serverId: string) {
  const [row] = await db
    .select()
    .from(serverMetrics)
    .where(eq(serverMetrics.serverId, serverId))
    .orderBy(desc(serverMetrics.collectedAt))
    .limit(1);
  return row ?? null;
}

export async function listServerMetricsHistory(serverId: string, limit: number, since?: string) {
  const conditions = [eq(serverMetrics.serverId, serverId)];

  if (since) {
    const match = /^(\d+)([mhdw])$/.exec(since);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit =
        match[2] === "m"
          ? "minutes"
          : match[2] === "h"
            ? "hours"
            : match[2] === "w"
              ? "weeks"
              : "days";
      conditions.push(
        gte(serverMetrics.collectedAt, sql`now() - interval '${sql.raw(`${value} ${unit}`)}'`)
      );
    }
  }

  return db
    .select()
    .from(serverMetrics)
    .where(and(...conditions))
    .orderBy(desc(serverMetrics.collectedAt))
    .limit(limit);
}

export async function listTeamServersLatestMetrics(teamId: string) {
  const allServers = await db
    .select({ id: servers.id, name: servers.name })
    .from(servers)
    .where(eq(servers.teamId, teamId));
  const results = [];
  for (const server of allServers) {
    const latest = await getLatestServerMetrics(server.id);
    if (latest) {
      results.push({ serverName: server.name, ...latest });
    }
  }
  return results;
}

/**
 * Public monitoring read model for UI and CLI consumers. The caller should
 * first resolve the server in its team scope, then request this aggregate.
 */
export async function getServerMetricMonitoring(
  serverId: string,
  limit = 60,
  since?: string
): Promise<ServerMetricMonitoringResult> {
  const safeLimit = Number.isFinite(limit) ? Math.min(Math.max(Math.floor(limit), 1), 500) : 60;
  const [policy, state, latest, history, alerts] = await Promise.all([
    getServerMetricPolicy(serverId),
    getServerMetricState(serverId),
    getLatestServerMetrics(serverId),
    listServerMetricsHistory(serverId, safeLimit, since),
    listServerMetricAlerts(serverId, Math.min(safeLimit, 100))
  ]);

  return { serverId, policy, state, latest, history, alerts };
}

/**
 * Finds only verified, team-scoped servers that are due for a collection.
 * The monitor executes this read without changing host or workload state.
 */
export async function listServersDueForMetricCollection(
  input: {
    now?: Date;
    limit?: number;
  } = {}
): Promise<ServerMetricMonitoringCandidate[]> {
  const now = input.now ?? new Date();
  const rows = await db
    .select({
      server: servers,
      policy: serverMetricPolicies,
      state: serverMetricStates
    })
    .from(servers)
    .leftJoin(serverMetricPolicies, eq(serverMetricPolicies.serverId, servers.id))
    .leftJoin(serverMetricStates, eq(serverMetricStates.serverId, servers.id))
    .where(
      and(
        eq(servers.status, "ready"),
        isNotNull(servers.teamId),
        or(
          isNull(serverMetricStates.collectionLeaseExpiresAt),
          lte(serverMetricStates.collectionLeaseExpiresAt, now)
        ),
        sql`(
          ${serverMetricStates.lastCheckedAt} is null
          or ${serverMetricStates.lastCheckedAt} <= ${now} - (
            coalesce(
              ${serverMetricPolicies.sampleIntervalSeconds},
              ${DEFAULT_SERVER_METRIC_POLICY.sampleIntervalSeconds}
            ) * interval '1 second'
          )
        )`
      )
    )
    .orderBy(
      sql`case when ${serverMetricStates.lastCheckedAt} is null then 0 else 1 end`,
      asc(serverMetricStates.lastCheckedAt),
      asc(servers.createdAt)
    )
    .limit(input.limit ?? 100);

  return rows.map((row) => ({
    server: row.server,
    policy: toServerMetricPolicy(row.policy),
    state: toServerMetricState(row.state)
  }));
}

/**
 * Retention is intentionally scoped to one server's metric samples. It never
 * touches deployment, audit, operation, notification, or alert history.
 */
export async function pruneServerMetricSamples(
  serverId: string,
  retentionDays: number,
  now = new Date()
) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(serverMetrics)
    .where(and(eq(serverMetrics.serverId, serverId), lt(serverMetrics.collectedAt, cutoff)))
    .returning({ id: serverMetrics.id });
  return deleted.length;
}

/** @deprecated Prefer the per-server prune function so policy retention is honored. */
export async function cleanupOldServerMetrics(retentionDays: number, now = new Date()) {
  const cutoff = new Date(now.getTime() - retentionDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(serverMetrics)
    .where(lt(serverMetrics.collectedAt, cutoff))
    .returning({ id: serverMetrics.id });
  return deleted.length;
}
