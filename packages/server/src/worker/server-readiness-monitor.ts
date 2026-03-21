import { pollServerReadinessOnce } from "../db/services/server-readiness-polling";
import { resolveServerReadinessPollIntervalMs } from "../server-readiness-config";

const SERVER_READINESS_POLL_BATCH_SIZE = 8;
const SERVER_READINESS_DRAIN_SLEEP_MS = 1_000;

let running = false;

export interface ServerReadinessCycleLogEntry {
  level: "log" | "warn";
  message: string;
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveServerReadinessSleepMs(
  processedCount: number,
  intervalMs: number,
  batchSize = SERVER_READINESS_POLL_BATCH_SIZE
): number {
  return processedCount >= batchSize ? SERVER_READINESS_DRAIN_SLEEP_MS : intervalMs;
}

export function resolveServerReadinessCycleLogEntry(
  checkedCount: number,
  failedCount: number,
  previousCycleHadFailures: boolean
): ServerReadinessCycleLogEntry | null {
  const processedCount = checkedCount + failedCount;

  if (failedCount > 0) {
    if (previousCycleHadFailures) {
      return null;
    }

    return {
      level: "warn",
      message: `[server-readiness] Refresh cycle entered degraded state (${failedCount} failed, ${checkedCount} succeeded)`
    };
  }

  if (previousCycleHadFailures && processedCount > 0) {
    return {
      level: "log",
      message: `[server-readiness] Refresh cycle recovered (${checkedCount} server(s) refreshed cleanly)`
    };
  }

  return null;
}

export function resolveServerReadinessFailureState(
  checkedCount: number,
  failedCount: number,
  previousCycleHadFailures: boolean
): boolean {
  if (failedCount > 0) {
    return true;
  }

  if (checkedCount > 0) {
    return false;
  }

  return previousCycleHadFailures;
}

export function startServerReadinessMonitor(): void {
  if (running) {
    console.warn("[server-readiness] Monitor already running, skipping duplicate start");
    return;
  }

  running = true;
  const intervalMs = resolveServerReadinessPollIntervalMs();
  let previousCycleHadFailures = false;
  console.log(`[server-readiness] Monitor started (poll interval: ${intervalMs}ms)`);

  const poll = async () => {
    while (running) {
      try {
        const result = await pollServerReadinessOnce({
          intervalMs,
          limit: SERVER_READINESS_POLL_BATCH_SIZE
        });

        const cycleLogEntry = resolveServerReadinessCycleLogEntry(
          result.checkedCount,
          result.failedCount,
          previousCycleHadFailures
        );

        if (cycleLogEntry) {
          console[cycleLogEntry.level](cycleLogEntry.message);
        }

        previousCycleHadFailures = resolveServerReadinessFailureState(
          result.checkedCount,
          result.failedCount,
          previousCycleHadFailures
        );

        await sleep(
          resolveServerReadinessSleepMs(result.checkedCount + result.failedCount, intervalMs)
        );
      } catch (error) {
        console.error(
          "[server-readiness] Poll cycle failed:",
          error instanceof Error ? error.message : String(error)
        );

        await sleep(intervalMs);
      }
    }
  };

  void poll();
}

export function stopServerReadinessMonitor(): void {
  if (!running) {
    return;
  }

  running = false;
  console.log("[server-readiness] Monitor stopping");
}
