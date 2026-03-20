import { pollServerReadinessOnce } from "../db/services/server-readiness-polling";
import { resolveServerReadinessPollIntervalMs } from "../server-readiness-config";

const SERVER_READINESS_POLL_BATCH_SIZE = 8;
const SERVER_READINESS_DRAIN_SLEEP_MS = 1_000;

let running = false;

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

export function startServerReadinessMonitor(): void {
  if (running) {
    console.warn("[server-readiness] Monitor already running, skipping duplicate start");
    return;
  }

  running = true;
  const intervalMs = resolveServerReadinessPollIntervalMs();
  console.log(`[server-readiness] Monitor started (poll interval: ${intervalMs}ms)`);

  const poll = async () => {
    while (running) {
      try {
        const result = await pollServerReadinessOnce({
          intervalMs,
          limit: SERVER_READINESS_POLL_BATCH_SIZE
        });

        if (result.checkedCount > 0 || result.failedCount > 0) {
          console.log(
            `[server-readiness] Refreshed ${result.checkedCount} server(s) (${result.failedCount} failed)`
          );
        }

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
