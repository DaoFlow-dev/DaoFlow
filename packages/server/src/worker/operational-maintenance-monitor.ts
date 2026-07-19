import { resolveOperationalMaintenancePollIntervalMs } from "../operational-maintenance-config";
import { runOperationalMaintenanceOnce } from "../db/services/operational-maintenance";
import { reconcileQueuedControlPlaneRecoveryBundles } from "../db/services/control-plane-recovery";
import { isTemporalEnabled } from "./temporal/temporal-config";

let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startOperationalMaintenanceMonitor(): void {
  if (running) {
    console.warn("[maintenance] Monitor already running, skipping duplicate start");
    return;
  }

  running = true;
  const pollIntervalMs = resolveOperationalMaintenancePollIntervalMs();
  console.log(`[maintenance] Monitor started (poll interval: ${pollIntervalMs}ms)`);

  const poll = async () => {
    while (running) {
      try {
        const recoveryDispatch = isTemporalEnabled()
          ? await reconcileQueuedControlPlaneRecoveryBundles()
          : { eligibleCount: 0, dispatchedCount: 0, failures: [] };
        const result = await runOperationalMaintenanceOnce({
          trigger: "monitor"
        });

        const changedCount =
          result.stalledDeployments.failedCount +
          result.stalePreviews.queuedCount +
          result.expiredCliAuthRequests.deletedCount +
          result.retainedArtifacts.prunedCount +
          recoveryDispatch.dispatchedCount;

        if (
          changedCount > 0 ||
          result.stalePreviews.failures.length > 0 ||
          recoveryDispatch.failures.length > 0
        ) {
          const logMethod =
            result.stalePreviews.failures.length > 0 || recoveryDispatch.failures.length > 0
              ? "warn"
              : "log";
          console[logMethod](
            `[maintenance] ${result.summary}; recovery dispatches=${recoveryDispatch.dispatchedCount}, failures=${recoveryDispatch.failures.length}`
          );
        }
      } catch (error) {
        console.error(
          "[maintenance] Poll cycle failed:",
          error instanceof Error ? error.message : String(error)
        );
      }

      await sleep(pollIntervalMs);
    }
  };

  void poll();
}

export function stopOperationalMaintenanceMonitor(): void {
  if (!running) {
    return;
  }

  running = false;
  console.log("[maintenance] Monitor stopping");
}
