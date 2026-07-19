import { evaluateServerMetricState } from "../db/services/server-metric-evaluator";
import type { ServerMetricMonitoringCandidate } from "../db/services/server-metrics";
import type { ServerMetricAlertTransition } from "../db/services/server-metric-types";
import type { ServerMetricsSnapshot } from "./server-metrics-collector";
import type {
  ServerMetricMonitorClock,
  ServerMetricMonitorDependencies
} from "./server-metrics-monitor";

export interface ServerMetricCollectionCycleOutcome {
  snapshot: ServerMetricsSnapshot | null;
  transitions: ServerMetricAlertTransition[];
}

export async function processServerMetricCandidate(input: {
  candidate: ServerMetricMonitoringCandidate;
  owner: string;
  clock: ServerMetricMonitorClock;
  dependencies: ServerMetricMonitorDependencies;
}): Promise<ServerMetricCollectionCycleOutcome | null> {
  const { candidate, clock, dependencies } = input;
  const teamId = candidate.server.teamId;
  if (!teamId) throw new Error("Metric collection requires a team-scoped server.");
  const lease = await dependencies.claimCollection({
    serverId: candidate.server.id,
    expectedGeneration: candidate.state.collectionGeneration,
    owner: input.owner,
    now: clock()
  });
  if (!lease) return null;

  let snapshot: ServerMetricsSnapshot | null = null;
  try {
    const target = await dependencies.resolveTarget(
      candidate.server,
      `server-metrics-${candidate.server.id}`,
      teamId
    );
    snapshot = await dependencies.collectMetrics(target);
  } catch {
    snapshot = null;
  }
  const persistNow = clock();
  const evaluation = evaluateServerMetricState({
    policy: candidate.policy,
    snapshot,
    previousState: candidate.state,
    now: persistNow
  });
  await dependencies.persistCollection({
    lease,
    snapshot,
    state: {
      currentState: evaluation.currentState,
      metricStates: evaluation.metricStates,
      lastCheckedAt: persistNow,
      lastCollectedAt: snapshot ? persistNow : candidate.state.lastCollectedAt,
      lastUnreachableAt: snapshot ? candidate.state.lastUnreachableAt : persistNow,
      lastTransitionAt:
        evaluation.transitions.length > 0 ? persistNow : candidate.state.lastTransitionAt,
      lastAlertAt: candidate.state.lastAlertAt
    },
    transitions: evaluation.transitions,
    now: persistNow
  });
  await dependencies.pruneSamples(candidate.server.id, candidate.policy.retentionDays, clock());
  return { snapshot, transitions: evaluation.transitions };
}
