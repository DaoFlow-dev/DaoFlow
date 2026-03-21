/**
 * temporal-worker.ts
 *
 * Bootstrap the Temporal worker that polls the task queue for deployment
 * workflow tasks and executes them using the registered activities.
 *
 * Replaces the old DB-polling worker loop.
 */

import { NativeConnection, Worker } from "@temporalio/worker";
import * as deployActivities from "./activities/deploy-activities";
import * as backupActivities from "./activities/backup-activities";
import * as backupLogActivities from "./activities/backup-log-activities";
import * as databaseActivities from "./activities/database-activities";
import * as retentionActivities from "./activities/retention-activities";
import * as notificationActivities from "./activities/notification-activities";
import { resolve } from "node:path";
import { TEMPORAL_ADDRESS, TEMPORAL_NAMESPACE, TEMPORAL_TASK_QUEUE } from "./temporal-config";

const activities = {
  ...deployActivities,
  ...backupActivities,
  ...backupLogActivities,
  ...databaseActivities,
  ...retentionActivities,
  ...notificationActivities
};

let worker: Worker | null = null;
const TEMPORAL_CONNECT_TIMEOUT_MS = Number(process.env.TEMPORAL_CONNECT_TIMEOUT_MS ?? 30_000);
const TEMPORAL_CONNECT_RETRY_DELAY_MS = Number(
  process.env.TEMPORAL_CONNECT_RETRY_DELAY_MS ?? 2_000
);

function sleep(ms: number): Promise<void> {
  return new Promise((resolveSleep) => {
    setTimeout(resolveSleep, ms);
  });
}

async function connectWithRetry(): Promise<NativeConnection> {
  const deadline = Date.now() + TEMPORAL_CONNECT_TIMEOUT_MS;
  let attempt = 0;
  let lastError: unknown;

  while (Date.now() <= deadline) {
    attempt += 1;

    try {
      return await NativeConnection.connect({ address: TEMPORAL_ADDRESS });
    } catch (error) {
      lastError = error;
      const remainingMs = deadline - Date.now();
      if (remainingMs <= 0) {
        break;
      }

      const retryDelayMs = Math.min(TEMPORAL_CONNECT_RETRY_DELAY_MS, remainingMs);
      console.warn(
        `[temporal-worker] Connection attempt ${attempt} failed; retrying in ${retryDelayMs}ms`
      );
      await sleep(retryDelayMs);
    }
  }

  throw lastError instanceof Error ? lastError : new Error("Temporal connection failed");
}

/**
 * Start the Temporal worker.
 *
 * The worker registers:
 * - Workflows from the `workflows/` directory (bundled by Temporal's webpack)
 * - Activities from `deploy-activities.ts` (direct function references)
 */
export async function startTemporalWorker(): Promise<void> {
  if (worker) {
    console.warn("[temporal-worker] Worker already running, skipping duplicate start");
    return;
  }

  console.log(`[temporal-worker] Connecting to Temporal at ${TEMPORAL_ADDRESS}...`);

  const connection = await connectWithRetry();

  worker = await Worker.create({
    connection,
    namespace: TEMPORAL_NAMESPACE,
    taskQueue: TEMPORAL_TASK_QUEUE,
    workflowsPath: resolve(__dirname, "workflows"),
    activities,
    maxConcurrentActivityTaskExecutions: 10,
    maxConcurrentWorkflowTaskExecutions: 10
  });

  console.log(`[temporal-worker] Worker started on task queue: ${TEMPORAL_TASK_QUEUE}`);

  // Worker.run() blocks until shutdown signal
  await worker.run();
}

/**
 * Stop the Temporal worker gracefully.
 */
export function stopTemporalWorker(): void {
  if (worker) {
    console.log("[temporal-worker] Shutting down Temporal worker...");
    worker.shutdown();
    worker = null;
  }
}
