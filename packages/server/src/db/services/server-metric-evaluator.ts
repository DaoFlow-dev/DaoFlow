import type { ServerMetricsSnapshot } from "../../worker/server-metrics-collector";
import { getServerMetricThresholds, type ServerMetricPolicy } from "./server-metric-policy";
import {
  SERVER_METRIC_KEYS,
  type ServerMetricAlertTransition,
  type ServerMetricTransitionEventType,
  type ServerMetricKey,
  type ServerMetricState,
  type ServerMetricStatus,
  type ServerMetricThresholdState,
  type ServerMetricThresholdStates
} from "./server-metric-types";

const DEFAULT_HYSTERESIS_PERCENT = 5;

export interface ServerMetricEvaluation {
  currentState: ServerMetricStatus;
  metricStates: ServerMetricThresholdStates;
  transitions: ServerMetricAlertTransition[];
  /** @deprecated Delivery cooldown is now applied from the durable outbox. */
  alerts: ServerMetricAlertTransition[];
}

export interface EvaluateServerMetricStateInput {
  policy: ServerMetricPolicy;
  snapshot: ServerMetricsSnapshot | null;
  previousState: Pick<ServerMetricState, "currentState" | "metricStates" | "lastAlertAt">;
  now?: Date;
  hysteresisPercent?: number;
}

function metricValue(snapshot: ServerMetricsSnapshot, metric: ServerMetricKey): number | null {
  switch (metric) {
    case "cpu":
      return snapshot.cpuPercent;
    case "memory":
      return snapshot.memoryUsedPercent;
    case "disk":
      return snapshot.diskUsedPercent;
    case "dockerDisk":
      return snapshot.dockerDiskUsedPercent;
  }
}

function thresholdForState(
  policy: ServerMetricPolicy,
  metric: ServerMetricKey,
  state: ServerMetricThresholdState
): number | null {
  const thresholds = getServerMetricThresholds(policy, metric);
  if (state === "warning") return thresholds.warning || null;
  if (state === "hard") return thresholds.hard || null;
  return null;
}

function evaluateMetricState(input: {
  value: number | null;
  warningThreshold: number;
  hardThreshold: number;
  previousState: ServerMetricThresholdState;
  hysteresisPercent: number;
}): ServerMetricThresholdState {
  const { value, warningThreshold, hardThreshold, previousState, hysteresisPercent } = input;
  if (value === null) return previousState;
  if (warningThreshold === 0 && hardThreshold === 0) {
    return "healthy";
  }

  const warningClearAt = Math.max(0, warningThreshold - hysteresisPercent);
  const hardClearAt = Math.max(0, hardThreshold - hysteresisPercent);

  if (previousState === "hard") {
    if (hardThreshold > 0 && value >= hardClearAt) return "hard";
    if (warningThreshold > 0 && value >= warningClearAt) return "warning";
    return "healthy";
  }

  if (previousState === "warning") {
    if (hardThreshold > 0 && value >= hardThreshold) return "hard";
    if (warningThreshold > 0 && value >= warningClearAt) return "warning";
    return "healthy";
  }

  if (hardThreshold > 0 && value >= hardThreshold) return "hard";
  if (warningThreshold > 0 && value >= warningThreshold) return "warning";
  return "healthy";
}

function combineMetricStates(
  metricStates: ServerMetricThresholdStates
): ServerMetricThresholdState {
  if (Object.values(metricStates).some((state) => state === "hard")) return "hard";
  if (Object.values(metricStates).some((state) => state === "warning")) return "warning";
  return "healthy";
}

function transitionType(
  previousState: ServerMetricStatus,
  nextState: ServerMetricStatus
): ServerMetricAlertTransition["transitionType"] {
  if (nextState === "unreachable") return "unreachable";
  if (nextState === "healthy") return "recovery";
  return "transition";
}

function transitionEventType(nextState: ServerMetricStatus): ServerMetricTransitionEventType {
  if (nextState === "unreachable") return "server.metrics.unreachable";
  if (nextState === "hard") return "server.metrics.hard";
  if (nextState === "warning") return "server.metrics.warning";
  return "server.metrics.recovered";
}

/**
 * Evaluates all threshold dimensions together. Every transition is queued;
 * notification cooldown is deliberately applied later, per metric/event, by
 * the durable delivery worker.
 */
export function evaluateServerMetricState(
  input: EvaluateServerMetricStateInput
): ServerMetricEvaluation {
  const now = input.now ?? new Date();
  const hysteresisPercent = input.hysteresisPercent ?? DEFAULT_HYSTERESIS_PERCENT;
  const previousState = input.previousState;

  if (!input.snapshot) {
    const transitions: ServerMetricAlertTransition[] =
      previousState.currentState === "unreachable"
        ? []
        : [
            {
              metricKey: "availability",
              eventType: "server.metrics.unreachable",
              transitionType: "unreachable",
              previousState: previousState.currentState,
              nextState: "unreachable",
              measuredValue: null,
              thresholdValue: null,
              occurredAt: now
            }
          ];

    return {
      currentState: "unreachable",
      metricStates: previousState.metricStates,
      transitions,
      alerts: transitions
    };
  }

  const metricStates: ServerMetricThresholdStates = {};
  const transitions: ServerMetricAlertTransition[] = [];
  const resumedFromUnreachable = previousState.currentState === "unreachable";

  for (const metric of SERVER_METRIC_KEYS) {
    const thresholds = getServerMetricThresholds(input.policy, metric);
    const enabled = thresholds.warning > 0 || thresholds.hard > 0;
    const previousMetricState = previousState.metricStates[metric] ?? "healthy";
    const value = metricValue(input.snapshot, metric);
    if (!enabled) {
      metricStates[metric] = "healthy";
      continue;
    }
    if (value === null) {
      metricStates[metric] = previousMetricState;
      continue;
    }
    const nextMetricState = evaluateMetricState({
      value,
      warningThreshold: thresholds.warning,
      hardThreshold: thresholds.hard,
      previousState: previousMetricState,
      hysteresisPercent
    });

    metricStates[metric] = nextMetricState;
    if (previousMetricState === nextMetricState) continue;

    transitions.push({
      metricKey: metric,
      eventType: transitionEventType(nextMetricState),
      transitionType: transitionType(previousMetricState, nextMetricState),
      previousState: previousMetricState,
      nextState: nextMetricState,
      measuredValue: value,
      thresholdValue:
        nextMetricState === "healthy"
          ? thresholdForState(input.policy, metric, previousMetricState)
          : thresholdForState(input.policy, metric, nextMetricState),
      occurredAt: now
    });
  }

  const currentState = combineMetricStates(metricStates);
  if (resumedFromUnreachable) {
    transitions.unshift({
      metricKey: "availability",
      eventType: "server.metrics.recovered",
      transitionType: "recovery",
      previousState: "unreachable",
      nextState: currentState,
      measuredValue: null,
      thresholdValue: null,
      occurredAt: now
    });
  }

  return {
    currentState,
    metricStates,
    transitions,
    alerts: transitions
  };
}
