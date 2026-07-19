import {
  persistServerMetricCollection,
  type PersistServerMetricCollectionInput
} from "../db/services/server-metric-collection-persistence";
import {
  claimServerMetricCollection,
  type ServerMetricCollectionLease
} from "../db/services/server-metric-lease";
import {
  claimNextServerMetricOutbox,
  type ClaimedServerMetricOutboxDelivery
} from "../db/services/server-metric-outbox";
import {
  claimServerMetricOutboxCooldown,
  markServerMetricOutboxFailure,
  markServerMetricOutboxSent,
  renewServerMetricOutboxDeliveryLease
} from "../db/services/server-metric-outbox-delivery";
import {
  listServersDueForMetricCollection,
  pruneServerMetricSamples,
  type ServerMetricMonitoringCandidate
} from "../db/services/server-metrics";
import type { ServerMetricAlertTransition } from "../db/services/server-metric-types";
import { newId } from "../db/services/json-helpers";
import { resolveExecutionTarget, type ExecutionTarget } from "./execution-target";
import { collectServerMetrics, type ServerMetricsSnapshot } from "./server-metrics-collector";
import { processServerMetricCandidate } from "./server-metrics-monitor-collection";
import { deliverServerMetricOutboxEntry } from "./server-metrics-monitor-delivery";
import { boundedInteger, processWithConcurrency, sleep } from "./server-metrics-monitor-support";

const DEFAULT_MONITOR_POLL_INTERVAL_MS = 15_000;
const MIN_MONITOR_POLL_INTERVAL_MS = 1_000;
const DEFAULT_MONITOR_CONCURRENCY = 4;
const MAX_MONITOR_CONCURRENCY = 16;
const DEFAULT_OUTBOX_LIMIT = 100;

let configuredTransitionHandler: ServerMetricTransitionHandler | null = null;
let monitorLoop: Promise<void> | null = null;
let monitorAbortController: AbortController | null = null;
const monitorOwner = newId();

export interface ServerMetricMonitorTransition {
  serverId: string;
  serverName: string;
  teamId: string;
  transition: ServerMetricAlertTransition;
}

export interface ServerMetricOutboxTransition extends ServerMetricMonitorTransition {
  channelId: string;
}

export type ServerMetricTransitionHandler = (
  transition: ServerMetricOutboxTransition
) => Promise<void> | void;

export type ServerMetricMonitorClock = () => Date;

export interface ServerMetricMonitorDependencies {
  listDueServers: (input: {
    now: Date;
    limit: number;
  }) => Promise<ServerMetricMonitoringCandidate[]>;
  claimCollection: (input: {
    serverId: string;
    expectedGeneration: number;
    owner: string;
    now: Date;
  }) => Promise<ServerMetricCollectionLease | null>;
  resolveTarget: (
    server: ServerMetricMonitoringCandidate["server"],
    operationId: string,
    teamId: string
  ) => Promise<ExecutionTarget>;
  collectMetrics: (target: ExecutionTarget) => Promise<ServerMetricsSnapshot | null>;
  persistCollection: (input: PersistServerMetricCollectionInput) => Promise<number>;
  pruneSamples: (serverId: string, retentionDays: number, now: Date) => Promise<number>;
  claimOutbox: (input: {
    owner: string;
    now: Date;
  }) => Promise<ClaimedServerMetricOutboxDelivery | null>;
  claimOutboxCooldown: (input: {
    delivery: ClaimedServerMetricOutboxDelivery;
    now: Date;
  }) => Promise<"deliver" | "suppressed" | "busy" | "lost">;
  renewOutboxLease: (input: {
    delivery: ClaimedServerMetricOutboxDelivery;
    now: Date;
  }) => Promise<boolean>;
  markOutboxSent: (input: {
    delivery: ClaimedServerMetricOutboxDelivery;
    now: Date;
  }) => Promise<unknown>;
  markOutboxFailure: (input: {
    delivery: ClaimedServerMetricOutboxDelivery;
    error: unknown;
    now: Date;
  }) => Promise<unknown>;
}

export interface RunServerMetricsMonitorCycleOptions {
  clock?: ServerMetricMonitorClock;
  concurrency?: number;
  limit?: number;
  outboxLimit?: number;
  owner?: string;
  onTransition?: ServerMetricTransitionHandler;
  dependencies?: Partial<ServerMetricMonitorDependencies>;
}

export interface ServerMetricsMonitorCycleResult {
  processedCount: number;
  sampledCount: number;
  unreachableCount: number;
  alertCount: number;
  deliveredCount: number;
  suppressedCount: number;
  transitions: ServerMetricMonitorTransition[];
  failures: Array<{ serverId: string; message: string }>;
}

const defaultDependencies: ServerMetricMonitorDependencies = {
  listDueServers: listServersDueForMetricCollection,
  claimCollection: claimServerMetricCollection,
  resolveTarget: resolveExecutionTarget,
  collectMetrics: collectServerMetrics,
  persistCollection: persistServerMetricCollection,
  pruneSamples: pruneServerMetricSamples,
  claimOutbox: claimNextServerMetricOutbox,
  claimOutboxCooldown: claimServerMetricOutboxCooldown,
  renewOutboxLease: renewServerMetricOutboxDeliveryLease,
  markOutboxSent: markServerMetricOutboxSent,
  markOutboxFailure: markServerMetricOutboxFailure
};

export function resolveServerMetricsMonitorPollIntervalMs(
  rawValue = process.env.SERVER_METRICS_MONITOR_POLL_INTERVAL_MS
) {
  return boundedInteger(
    rawValue,
    DEFAULT_MONITOR_POLL_INTERVAL_MS,
    MIN_MONITOR_POLL_INTERVAL_MS,
    300_000
  );
}

export function resolveServerMetricsMonitorConcurrency(
  rawValue = process.env.SERVER_METRICS_MONITOR_CONCURRENCY
) {
  return boundedInteger(rawValue, DEFAULT_MONITOR_CONCURRENCY, 1, MAX_MONITOR_CONCURRENCY);
}

export function setServerMetricTransitionHandler(
  handler: ServerMetricTransitionHandler | null
): void {
  configuredTransitionHandler = handler;
}

function defaultTransitionHandler(event: ServerMetricOutboxTransition): void {
  console.log(
    `[server-metrics] ${event.transition.eventType} server=${event.serverName} metric=${event.transition.metricKey}`
  );
}

function transitionHandler(override: ServerMetricTransitionHandler | undefined) {
  return override ?? configuredTransitionHandler ?? defaultTransitionHandler;
}

function resolveServerMetricsMonitorClock(
  options: Pick<RunServerMetricsMonitorCycleOptions, "clock">
): ServerMetricMonitorClock {
  if (options.clock) return options.clock;
  return () => new Date();
}

export async function runServerMetricsMonitorCycle(
  options: RunServerMetricsMonitorCycleOptions = {}
): Promise<ServerMetricsMonitorCycleResult> {
  const clock = resolveServerMetricsMonitorClock(options);
  const concurrency = Math.max(
    1,
    Math.min(options.concurrency ?? resolveServerMetricsMonitorConcurrency(), 16)
  );
  const dependencies = { ...defaultDependencies, ...options.dependencies };
  const owner = options.owner ?? monitorOwner;
  const candidates = await dependencies.listDueServers({
    now: clock(),
    limit: options.limit ?? DEFAULT_OUTBOX_LIMIT
  });
  const result: ServerMetricsMonitorCycleResult = {
    processedCount: 0,
    sampledCount: 0,
    unreachableCount: 0,
    alertCount: 0,
    deliveredCount: 0,
    suppressedCount: 0,
    transitions: [],
    failures: []
  };

  await processWithConcurrency(candidates, concurrency, async (candidate) => {
    try {
      const outcome = await processServerMetricCandidate({ candidate, owner, clock, dependencies });
      if (!outcome) return;
      result.processedCount += 1;
      result.sampledCount += Number(outcome.snapshot !== null);
      result.unreachableCount += Number(outcome.snapshot === null);
      result.alertCount += outcome.transitions.length;
      result.transitions.push(
        ...outcome.transitions.map((transition) => ({
          serverId: candidate.server.id,
          serverName: candidate.server.name,
          teamId: candidate.server.teamId ?? "",
          transition
        }))
      );
    } catch (error) {
      result.failures.push({
        serverId: candidate.server.id,
        message: error instanceof Error ? error.message : String(error)
      });
    }
  });

  const outboxSlots = Array.from(
    { length: options.outboxLimit ?? DEFAULT_OUTBOX_LIMIT },
    (_, index) => index
  );
  await processWithConcurrency(outboxSlots, concurrency, async () => {
    const outcome = await deliverServerMetricOutboxEntry({
      owner,
      clock,
      dependencies,
      onTransition: transitionHandler(options.onTransition)
    });
    result.deliveredCount += outcome.delivered;
    result.suppressedCount += outcome.suppressed;
  });
  return result;
}

async function runPollingLoop(input: {
  signal: AbortSignal;
  pollIntervalMs: number;
  runCycle: () => Promise<ServerMetricsMonitorCycleResult>;
}) {
  while (!input.signal.aborted) {
    try {
      const result = await input.runCycle();
      if (result.failures.length > 0)
        console.warn(`[server-metrics] ${result.failures.length} collection failure(s).`);
    } catch (error) {
      console.error(
        "[server-metrics] Poll cycle failed:",
        error instanceof Error ? error.message : String(error)
      );
    }
    if (!input.signal.aborted) await sleep(input.pollIntervalMs, input.signal);
  }
}

export function startServerMetricsMonitor(
  input: {
    pollIntervalMs?: number;
    runCycle?: () => Promise<ServerMetricsMonitorCycleResult>;
  } = {}
): Promise<void> {
  if (monitorLoop) return monitorLoop;
  const controller = new AbortController();
  monitorAbortController = controller;
  const loop = runPollingLoop({
    signal: controller.signal,
    pollIntervalMs: input.pollIntervalMs ?? resolveServerMetricsMonitorPollIntervalMs(),
    runCycle: input.runCycle ?? (() => runServerMetricsMonitorCycle())
  }).finally(() => {
    if (monitorLoop === loop) {
      monitorLoop = null;
      monitorAbortController = null;
    }
  });
  monitorLoop = loop;
  return loop;
}

export async function stopServerMetricsMonitor(): Promise<void> {
  const loop = monitorLoop;
  if (!loop) return;
  monitorAbortController?.abort();
  await loop;
}
