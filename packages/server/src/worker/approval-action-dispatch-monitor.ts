import {
  processNextApprovalActionDispatch,
  reconcileApprovalActionDispatches
} from "../db/services/approval-dispatch-service";

const DEFAULT_APPROVAL_DISPATCH_POLL_INTERVAL_MS = 5_000;
const MIN_APPROVAL_DISPATCH_POLL_INTERVAL_MS = 1_000;
const MAX_DISPATCHES_PER_CYCLE = 8;

let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveApprovalActionDispatchPollIntervalMs(
  rawValue = process.env.APPROVAL_ACTION_DISPATCH_POLL_INTERVAL_MS
) {
  const parsed = Number(rawValue ?? DEFAULT_APPROVAL_DISPATCH_POLL_INTERVAL_MS);
  if (!Number.isFinite(parsed) || parsed < MIN_APPROVAL_DISPATCH_POLL_INTERVAL_MS) {
    return DEFAULT_APPROVAL_DISPATCH_POLL_INTERVAL_MS;
  }

  return Math.floor(parsed);
}

export function startApprovalActionDispatchMonitor(): void {
  if (running) {
    console.warn("[approval-dispatch] Monitor already running, skipping duplicate start");
    return;
  }

  running = true;
  const pollIntervalMs = resolveApprovalActionDispatchPollIntervalMs();
  console.log(`[approval-dispatch] Monitor started (poll interval: ${pollIntervalMs}ms)`);

  const poll = async () => {
    while (running) {
      try {
        let dispatchedCount = 0;
        for (let index = 0; index < MAX_DISPATCHES_PER_CYCLE; index += 1) {
          const result = await processNextApprovalActionDispatch();
          if (!result) break;
          if (result.status === "dispatched") dispatchedCount += 1;
        }
        const reconciled = await reconcileApprovalActionDispatches();
        if (dispatchedCount > 0 || reconciled.length > 0) {
          console.log(
            `[approval-dispatch] submitted=${dispatchedCount}, reconciled=${reconciled.length}`
          );
        }
      } catch (error) {
        console.error(
          "[approval-dispatch] Poll cycle failed:",
          error instanceof Error ? error.message : String(error)
        );
      }

      await sleep(pollIntervalMs);
    }
  };

  void poll();
}

export function stopApprovalActionDispatchMonitor(): void {
  if (!running) return;
  running = false;
  console.log("[approval-dispatch] Monitor stopping");
}
