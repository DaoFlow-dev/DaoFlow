export const DEFAULT_SERVER_READINESS_POLL_INTERVAL_MS = 60_000;
const MIN_SERVER_READINESS_POLL_INTERVAL_MS = 5_000;
const MAX_SERVER_READINESS_POLL_INTERVAL_MS = 24 * 60 * 60 * 1_000;

export function resolveServerReadinessPollIntervalMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.SERVER_READINESS_POLL_INTERVAL_MS;
  if (!raw) {
    return DEFAULT_SERVER_READINESS_POLL_INTERVAL_MS;
  }

  const parsed = Number.parseInt(raw, 10);
  if (!Number.isFinite(parsed)) {
    return DEFAULT_SERVER_READINESS_POLL_INTERVAL_MS;
  }

  return Math.min(
    MAX_SERVER_READINESS_POLL_INTERVAL_MS,
    Math.max(MIN_SERVER_READINESS_POLL_INTERVAL_MS, parsed)
  );
}
