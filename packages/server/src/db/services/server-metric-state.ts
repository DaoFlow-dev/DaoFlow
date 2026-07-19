import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { serverMetricAlerts, serverMetricStates } from "../schema/server-metrics";
import { servers } from "../schema/servers";
import { newId } from "./json-helpers";
import type {
  ServerMetricAlertTransition,
  ServerMetricState,
  ServerMetricStatus,
  ServerMetricThresholdState,
  ServerMetricThresholdStates
} from "./server-metric-types";

const STATUS_VALUES = new Set<ServerMetricStatus>(["healthy", "warning", "hard", "unreachable"]);
const THRESHOLD_STATE_VALUES = new Set<ServerMetricThresholdState>(["healthy", "warning", "hard"]);

function parseStatus(value: unknown): ServerMetricStatus {
  return typeof value === "string" && STATUS_VALUES.has(value as ServerMetricStatus)
    ? (value as ServerMetricStatus)
    : "healthy";
}

function parseMetricStates(value: unknown): ServerMetricThresholdStates {
  if (!value || typeof value !== "object" || Array.isArray(value)) return {};

  const states: ServerMetricThresholdStates = {};
  for (const [key, state] of Object.entries(value as Record<string, unknown>)) {
    if (
      (key === "cpu" || key === "memory" || key === "disk" || key === "dockerDisk") &&
      typeof state === "string" &&
      THRESHOLD_STATE_VALUES.has(state as ServerMetricThresholdState)
    ) {
      states[key] = state as ServerMetricThresholdState;
    }
  }
  return states;
}

export function toServerMetricState(
  row: typeof serverMetricStates.$inferSelect | null | undefined
): ServerMetricState {
  if (!row) {
    return {
      currentState: "healthy",
      metricStates: {},
      lastCheckedAt: null,
      lastCollectedAt: null,
      lastUnreachableAt: null,
      lastTransitionAt: null,
      lastAlertAt: null,
      collectionGeneration: 0
    };
  }

  return {
    currentState: parseStatus(row.currentState),
    metricStates: parseMetricStates(row.metricStates),
    lastCheckedAt: row.lastCheckedAt,
    lastCollectedAt: row.lastCollectedAt,
    lastUnreachableAt: row.lastUnreachableAt,
    lastTransitionAt: row.lastTransitionAt,
    lastAlertAt: row.lastAlertAt,
    collectionGeneration: row.collectionGeneration
  };
}

export async function getServerMetricState(serverId: string): Promise<ServerMetricState> {
  const [row] = await db
    .select()
    .from(serverMetricStates)
    .where(eq(serverMetricStates.serverId, serverId))
    .limit(1);
  return toServerMetricState(row);
}

export async function getServerMetricStateForTeam(serverId: string, teamId: string) {
  const [row] = await db
    .select({ state: serverMetricStates })
    .from(servers)
    .leftJoin(serverMetricStates, eq(serverMetricStates.serverId, servers.id))
    .where(and(eq(servers.id, serverId), eq(servers.teamId, teamId)))
    .limit(1);
  return row ? toServerMetricState(row.state) : null;
}

export async function upsertServerMetricState(input: {
  serverId: string;
  state: ServerMetricState;
}) {
  const now = new Date();
  await db
    .insert(serverMetricStates)
    .values({
      serverId: input.serverId,
      currentState: input.state.currentState,
      metricStates: input.state.metricStates,
      lastCheckedAt: input.state.lastCheckedAt,
      lastCollectedAt: input.state.lastCollectedAt,
      lastUnreachableAt: input.state.lastUnreachableAt,
      lastTransitionAt: input.state.lastTransitionAt,
      lastAlertAt: input.state.lastAlertAt,
      collectionGeneration: input.state.collectionGeneration,
      updatedAt: now
    })
    .onConflictDoUpdate({
      target: serverMetricStates.serverId,
      set: {
        currentState: input.state.currentState,
        metricStates: input.state.metricStates,
        lastCheckedAt: input.state.lastCheckedAt,
        lastCollectedAt: input.state.lastCollectedAt,
        lastUnreachableAt: input.state.lastUnreachableAt,
        lastTransitionAt: input.state.lastTransitionAt,
        lastAlertAt: input.state.lastAlertAt,
        collectionGeneration: input.state.collectionGeneration,
        updatedAt: now
      }
    });
}

export async function recordServerMetricAlert(input: {
  serverId: string;
  transition: ServerMetricAlertTransition;
}) {
  const id = newId();
  await db.insert(serverMetricAlerts).values({
    id,
    serverId: input.serverId,
    metricKey: input.transition.metricKey,
    eventType: input.transition.eventType,
    transitionType: input.transition.transitionType,
    previousState: input.transition.previousState,
    nextState: input.transition.nextState,
    measuredValue: input.transition.measuredValue,
    thresholdValue: input.transition.thresholdValue,
    occurredAt: input.transition.occurredAt,
    notifiedAt: null
  });
  return id;
}

export async function markServerMetricAlertNotified(alertId: string, notifiedAt = new Date()) {
  await db.update(serverMetricAlerts).set({ notifiedAt }).where(eq(serverMetricAlerts.id, alertId));
}

export async function listServerMetricAlertsForTeam(input: {
  serverId: string;
  teamId: string;
  limit?: number;
}) {
  return db
    .select({ alert: serverMetricAlerts })
    .from(serverMetricAlerts)
    .innerJoin(servers, eq(servers.id, serverMetricAlerts.serverId))
    .where(and(eq(serverMetricAlerts.serverId, input.serverId), eq(servers.teamId, input.teamId)))
    .orderBy(desc(serverMetricAlerts.occurredAt))
    .limit(input.limit ?? 100);
}

export async function listServerMetricAlerts(serverId: string, limit = 20) {
  return db
    .select()
    .from(serverMetricAlerts)
    .where(eq(serverMetricAlerts.serverId, serverId))
    .orderBy(desc(serverMetricAlerts.occurredAt))
    .limit(limit);
}
