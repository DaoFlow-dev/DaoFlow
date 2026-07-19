export type MetricPolicy = {
  sampleIntervalSeconds: number;
  retentionDays: number;
  cpuWarnPercent: number;
  cpuHardPercent: number;
  memoryWarnPercent: number;
  memoryHardPercent: number;
  diskWarnPercent: number;
  diskHardPercent: number;
  dockerDiskWarnPercent: number;
  dockerDiskHardPercent: number;
  cooldownMinutes: number;
};

export type MetricStatus = "healthy" | "warning" | "hard" | "unreachable";

export type MetricSample = {
  id: string;
  collectedAt: string;
  [key: string]: unknown;
};

export type MetricReport = {
  policy: MetricPolicy;
  state: {
    status: MetricStatus;
    metric: string | null;
    measuredValue: number | null;
    threshold: number | null;
    activeMetrics?: Array<{
      metric: string;
      status: "warning" | "hard";
      measuredValue: number | null;
      threshold: number | null;
    }>;
    error: string | null;
  };
  latest: MetricSample | null;
  history: MetricSample[];
};

export function formatPercent(value: unknown) {
  return typeof value === "number" ? `${Number(value.toFixed(1))}%` : "—";
}

export function formatGb(value: unknown) {
  return typeof value === "number" ? `${Number(value.toFixed(2))} GB` : "—";
}

export function formatAge(collectedAt: string | null | undefined) {
  if (!collectedAt) return "—";
  const ageSeconds = Math.max(0, (Date.now() - Date.parse(collectedAt)) / 1000);
  if (!Number.isFinite(ageSeconds) || ageSeconds < 60) return "just now";
  if (ageSeconds < 3600) return `${Math.floor(ageSeconds / 60)} min ago`;
  if (ageSeconds < 86400) return `${Math.floor(ageSeconds / 3600)} hr ago`;
  return `${Math.floor(ageSeconds / 86400)} days ago`;
}
