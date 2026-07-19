import type { getServerMetricMonitoring } from "../db/services/server-metrics";

type ServerMetricMonitoring = Awaited<ReturnType<typeof getServerMetricMonitoring>>;

function metricValue(report: ServerMetricMonitoring, metric: string) {
  if (!report.latest) return null;
  if (metric === "cpu") return report.latest.cpuPercent;
  if (metric === "memory") return report.latest.memoryUsedPercent;
  if (metric === "disk") return report.latest.diskUsedPercent;
  if (metric === "dockerDisk") return report.latest.dockerDiskUsedPercent;
  return null;
}

function metricThreshold(report: ServerMetricMonitoring, metric: string, status: string) {
  const suffix = status === "hard" ? "HardPercent" : "WarnPercent";
  const key = `${metric}${suffix}` as keyof typeof report.policy;
  const value = report.policy[key];
  return typeof value === "number" && value > 0 ? value : null;
}

function serializeSample(sample: ServerMetricMonitoring["latest"]) {
  return sample
    ? {
        ...sample,
        collectedAt: sample.collectedAt.toISOString()
      }
    : null;
}

export function serializeServerMetricMonitoring(report: ServerMetricMonitoring) {
  const activeMetrics = Object.entries(report.state.metricStates)
    .filter(
      (entry): entry is [string, "warning" | "hard"] =>
        entry[1] === "warning" || entry[1] === "hard"
    )
    .map(([metric, status]) => ({
      metric,
      status,
      measuredValue: metricValue(report, metric),
      threshold: metricThreshold(report, metric, status)
    }))
    .sort((left, right) => Number(right.status === "hard") - Number(left.status === "hard"));
  const primaryMetric = activeMetrics[0] ?? null;
  return {
    serverId: report.serverId,
    policy: report.policy,
    state: {
      status: report.state.currentState,
      metric: primaryMetric?.metric ?? null,
      measuredValue: primaryMetric?.measuredValue ?? null,
      threshold: primaryMetric?.threshold ?? null,
      activeMetrics,
      changedAt: report.state.lastTransitionAt?.toISOString() ?? null,
      lastAlertedAt: report.state.lastAlertAt?.toISOString() ?? null,
      error:
        report.state.currentState === "unreachable"
          ? "The latest scheduled metric collection could not reach this server."
          : null
    },
    latest: serializeSample(report.latest),
    history: report.history.map((sample) => serializeSample(sample)!),
    alerts: report.alerts.map((alert) => ({
      ...alert,
      occurredAt: alert.occurredAt.toISOString(),
      notifiedAt: alert.notifiedAt?.toISOString() ?? null
    }))
  };
}
