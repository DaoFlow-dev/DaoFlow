import { createDueServiceScheduleRuns } from "../db/services/service-schedules";
import { pollServiceScheduleRuns } from "./service-schedule-runner";

const POLL_INTERVAL_MS = 60_000;
let running = false;

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function startServiceScheduleMonitor(): void {
  if (running) {
    console.warn("[service-schedules] Monitor already running, skipping duplicate start");
    return;
  }

  running = true;
  console.log(`[service-schedules] Monitor started (poll interval: ${POLL_INTERVAL_MS}ms)`);

  const poll = async () => {
    while (running) {
      try {
        await createDueServiceScheduleRuns({
          actor: {
            requestedByUserId: "service-schedule-runner",
            requestedByEmail: "service-schedule-runner@daoflow.local",
            requestedByRole: "operator"
          }
        });
        const result = await pollServiceScheduleRuns();
        if (result.processed > 0) {
          console.log(`[service-schedules] Processed ${result.processed} queued run(s).`);
        }
      } catch (error) {
        console.error(
          "[service-schedules] Poll cycle failed:",
          error instanceof Error ? error.message : String(error)
        );
      }

      await sleep(POLL_INTERVAL_MS);
    }
  };

  void poll();
}

export function stopServiceScheduleMonitor(): void {
  running = false;
}
