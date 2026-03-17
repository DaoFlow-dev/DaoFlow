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
import { resolve } from "node:path";

const activities = { ...deployActivities, ...backupActivities };

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "daoflow";
const TEMPORAL_TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "daoflow-deployments";

let worker: Worker | null = null;

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

  const connection = await NativeConnection.connect({ address: TEMPORAL_ADDRESS });

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
