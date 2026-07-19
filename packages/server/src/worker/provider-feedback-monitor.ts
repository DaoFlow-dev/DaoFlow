import { listRegisteredProviderFeedbackKinds } from "./provider-feedback-adapter-registry";
import { processNextProviderFeedback } from "./provider-feedback-processor";

const DEFAULT_PROVIDER_FEEDBACK_POLL_INTERVAL_MS = 5_000;
const MIN_PROVIDER_FEEDBACK_POLL_INTERVAL_MS = 1_000;
const MAX_PROVIDER_FEEDBACKS_PER_CYCLE = 8;

let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function resolveProviderFeedbackPollIntervalMs(
  rawValue = process.env.PROVIDER_FEEDBACK_POLL_INTERVAL_MS
) {
  const parsed = Number(rawValue ?? DEFAULT_PROVIDER_FEEDBACK_POLL_INTERVAL_MS);
  if (!Number.isFinite(parsed) || parsed < MIN_PROVIDER_FEEDBACK_POLL_INTERVAL_MS) {
    return DEFAULT_PROVIDER_FEEDBACK_POLL_INTERVAL_MS;
  }
  return Math.floor(parsed);
}

/**
 * With no registered adapters this does not claim anything, so records remain
 * pending until #228/#229 install their provider-specific adapters.
 */
export async function runProviderFeedbackMonitorCycle() {
  const providerKinds = listRegisteredProviderFeedbackKinds();
  if (providerKinds.length === 0) {
    return { status: "idle" as const, processedCount: 0 };
  }

  let processedCount = 0;
  for (let index = 0; index < MAX_PROVIDER_FEEDBACKS_PER_CYCLE; index += 1) {
    const result = await processNextProviderFeedback({ providerKinds });
    if (!result) break;
    if (result.status !== "idle") processedCount += 1;
  }
  return { status: "processed" as const, processedCount };
}

export function startProviderFeedbackMonitor(): void {
  if (running) {
    console.warn("[provider-feedback] Monitor already running, skipping duplicate start");
    return;
  }

  running = true;
  const pollIntervalMs = resolveProviderFeedbackPollIntervalMs();
  console.log(`[provider-feedback] Monitor started (poll interval: ${pollIntervalMs}ms)`);

  const poll = async () => {
    while (running) {
      try {
        const result = await runProviderFeedbackMonitorCycle();
        if (result.processedCount > 0) {
          console.log(`[provider-feedback] processed=${result.processedCount}`);
        }
      } catch (error) {
        console.error(
          "[provider-feedback] Poll cycle failed:",
          error instanceof Error ? error.message : String(error)
        );
      }
      await sleep(pollIntervalMs);
    }
  };

  void poll();
}

export function stopProviderFeedbackMonitor(): void {
  if (!running) return;
  running = false;
  console.log("[provider-feedback] Monitor stopping");
}
