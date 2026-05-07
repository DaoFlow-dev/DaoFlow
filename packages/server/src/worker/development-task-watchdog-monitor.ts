import { runDevelopmentTaskWatchdogOnce } from "../db/services/development-task-watchdog";

const DEFAULT_DEVELOPMENT_TASK_WATCHDOG_POLL_INTERVAL_MS = 30_000;
const MIN_DEVELOPMENT_TASK_WATCHDOG_POLL_INTERVAL_MS = 5_000;

let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveDevelopmentTaskWatchdogPollIntervalMs(
  rawValue = process.env.DEVELOPMENT_TASK_WATCHDOG_POLL_INTERVAL_MS
): number {
  const parsed = Number(rawValue ?? DEFAULT_DEVELOPMENT_TASK_WATCHDOG_POLL_INTERVAL_MS);
  if (!Number.isFinite(parsed) || parsed < MIN_DEVELOPMENT_TASK_WATCHDOG_POLL_INTERVAL_MS) {
    return DEFAULT_DEVELOPMENT_TASK_WATCHDOG_POLL_INTERVAL_MS;
  }

  return Math.floor(parsed);
}

export function startDevelopmentTaskWatchdogMonitor(): void {
  if (running) {
    console.warn("[development-task-watchdog] Monitor already running, skipping duplicate start");
    return;
  }

  running = true;
  const pollIntervalMs = resolveDevelopmentTaskWatchdogPollIntervalMs();
  console.log(`[development-task-watchdog] Monitor started (poll interval: ${pollIntervalMs}ms)`);

  const poll = async () => {
    while (running) {
      try {
        const result = await runDevelopmentTaskWatchdogOnce();
        if (result.failedCount > 0) {
          console.warn(
            `[development-task-watchdog] Marked ${result.failedCount} stalled development task run${result.failedCount === 1 ? "" : "s"} failed`
          );
        }
      } catch (error) {
        console.error(
          "[development-task-watchdog] Poll cycle failed:",
          error instanceof Error ? error.message : String(error)
        );
      }

      await sleep(pollIntervalMs);
    }
  };

  void poll();
}

export function stopDevelopmentTaskWatchdogMonitor(): void {
  if (!running) {
    return;
  }

  running = false;
  console.log("[development-task-watchdog] Monitor stopping");
}
