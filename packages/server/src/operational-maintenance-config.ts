const DEFAULT_OPERATIONAL_MAINTENANCE_POLL_INTERVAL_MS = 15 * 60_000;
const MIN_OPERATIONAL_MAINTENANCE_POLL_INTERVAL_MS = 60_000;

export function resolveOperationalMaintenancePollIntervalMs(
  rawValue = process.env.OPERATIONAL_MAINTENANCE_POLL_INTERVAL_MS
): number {
  const parsed = Number(rawValue ?? DEFAULT_OPERATIONAL_MAINTENANCE_POLL_INTERVAL_MS);
  if (!Number.isFinite(parsed) || parsed < MIN_OPERATIONAL_MAINTENANCE_POLL_INTERVAL_MS) {
    return DEFAULT_OPERATIONAL_MAINTENANCE_POLL_INTERVAL_MS;
  }

  return Math.floor(parsed);
}
