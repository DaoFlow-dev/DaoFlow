export const SERVER_METRIC_KEYS = ["cpu", "memory", "disk", "dockerDisk"] as const;

export type ServerMetricKey = (typeof SERVER_METRIC_KEYS)[number];
export type ServerMetricThresholdState = "healthy" | "warning" | "hard";
export type ServerMetricStatus = ServerMetricThresholdState | "unreachable";
export type ServerMetricTransitionType = "transition" | "recovery" | "unreachable";
export type ServerMetricTransitionEventType =
  | "server.metrics.warning"
  | "server.metrics.hard"
  | "server.metrics.recovered"
  | "server.metrics.unreachable";

export type ServerMetricThresholdStates = Partial<
  Record<ServerMetricKey, ServerMetricThresholdState>
>;

export interface ServerMetricState {
  currentState: ServerMetricStatus;
  metricStates: ServerMetricThresholdStates;
  lastCheckedAt: Date | null;
  lastCollectedAt: Date | null;
  lastUnreachableAt: Date | null;
  lastTransitionAt: Date | null;
  lastAlertAt: Date | null;
  collectionGeneration: number;
}

export interface ServerMetricAlertTransition {
  metricKey: ServerMetricKey | "availability";
  eventType: ServerMetricTransitionEventType;
  transitionType: ServerMetricTransitionType;
  previousState: ServerMetricStatus;
  nextState: ServerMetricStatus;
  measuredValue: number | null;
  thresholdValue: number | null;
  occurredAt: Date;
}
