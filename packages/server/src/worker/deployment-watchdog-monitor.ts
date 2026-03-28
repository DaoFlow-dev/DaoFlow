import {
  resolveDeploymentWatchdogTimeoutMs,
  runDeploymentWatchdogOnce
} from "../db/services/deployment-watchdog";

const DEFAULT_DEPLOYMENT_WATCHDOG_POLL_INTERVAL_MS = 15_000;
const MIN_DEPLOYMENT_WATCHDOG_POLL_INTERVAL_MS = 1_000;

let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveDeploymentWatchdogPollIntervalMs(
  rawValue = process.env.DEPLOYMENT_WATCHDOG_POLL_INTERVAL_MS
): number {
  const parsed = Number(rawValue ?? DEFAULT_DEPLOYMENT_WATCHDOG_POLL_INTERVAL_MS);
  if (!Number.isFinite(parsed) || parsed < MIN_DEPLOYMENT_WATCHDOG_POLL_INTERVAL_MS) {
    return DEFAULT_DEPLOYMENT_WATCHDOG_POLL_INTERVAL_MS;
  }

  return Math.floor(parsed);
}

export function startDeploymentWatchdogMonitor(): void {
  if (running) {
    console.warn("[deployment-watchdog] Monitor already running, skipping duplicate start");
    return;
  }

  running = true;
  const timeoutMs = resolveDeploymentWatchdogTimeoutMs();
  const pollIntervalMs = resolveDeploymentWatchdogPollIntervalMs();
  console.log(
    `[deployment-watchdog] Monitor started (timeout: ${timeoutMs}ms, poll interval: ${pollIntervalMs}ms)`
  );

  const poll = async () => {
    while (running) {
      try {
        const result = await runDeploymentWatchdogOnce({ timeoutMs });
        if (result.failedCount > 0) {
          console.warn(
            `[deployment-watchdog] Marked ${result.failedCount} stale deployment${result.failedCount === 1 ? "" : "s"} failed`
          );
        }
      } catch (error) {
        console.error(
          "[deployment-watchdog] Poll cycle failed:",
          error instanceof Error ? error.message : String(error)
        );
      }

      await sleep(pollIntervalMs);
    }
  };

  void poll();
}

export function stopDeploymentWatchdogMonitor(): void {
  if (!running) {
    return;
  }

  running = false;
  console.log("[deployment-watchdog] Monitor stopping");
}
