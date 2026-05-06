import { claimNextQueuedDevelopmentTask } from "../db/services/development-task-claims";

const DEVELOPMENT_TASK_POLL_INTERVAL_MS = 10_000;
let running = false;

export async function pollDevelopmentTaskQueue() {
  const claimed = await claimNextQueuedDevelopmentTask({
    runnerId: "development-task-worker",
    runnerLabel: "development-task-worker"
  });

  if (!claimed) {
    return null;
  }

  console.log(
    `[development-task-worker] Claimed task ${claimed.task.id} with run ${claimed.run.id}`
  );
  return claimed;
}

export function startDevelopmentTaskWorker(): void {
  if (running) {
    console.warn("[development-task-worker] Worker already running, skipping duplicate start");
    return;
  }

  running = true;
  console.log(
    `[development-task-worker] Worker started (poll interval: ${DEVELOPMENT_TASK_POLL_INTERVAL_MS}ms)`
  );

  const poll = async () => {
    while (running) {
      try {
        await pollDevelopmentTaskQueue();
      } catch (err) {
        console.error(
          "[development-task-worker] Unhandled error in poll loop:",
          err instanceof Error ? err.message : String(err)
        );
      }
      await new Promise((resolve) => setTimeout(resolve, DEVELOPMENT_TASK_POLL_INTERVAL_MS));
    }
  };

  void poll();
}

export function stopDevelopmentTaskWorker(): void {
  running = false;
  console.log("[development-task-worker] Worker stopping");
}
