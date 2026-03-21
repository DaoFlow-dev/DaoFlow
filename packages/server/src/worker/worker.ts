/**
 * worker.ts
 *
 * The deployment execution worker. Polls the database for queued deployments,
 * orchestrates the deployment lifecycle, and streams logs in real time.
 *
 * MVP: runs in-process with the server, uses local Docker socket.
 * Future: extract to a separate process, add SSH-based remote execution.
 *
 * Strategies and step management have been extracted to:
 *  - ./step-management.ts
 *  - ./deploy-strategies.ts
 */

import type { DeploymentRow } from "./step-management";
import { runDeployment } from "./run-deployment";
import { claimNextQueuedDeploymentForExecution } from "../db/services/deployment-execution-control";

const POLL_INTERVAL_MS = 5_000;
let running = false;

/* ──────────────────────── Deployment Execution ──────────────────────── */

async function executeDeployment(deployment: DeploymentRow): Promise<void> {
  try {
    console.log(`[worker] Executing deployment ${deployment.id} for ${deployment.serviceName}`);
    const outcome = await runDeployment(deployment, "execution-worker");
    if (outcome === "cancelled") {
      console.log(`[worker] Deployment ${deployment.id} cancelled after user request`);
      return;
    }
    console.log(`[worker] Deployment ${deployment.id} completed successfully`);
  } catch (err) {
    console.error(
      `[worker] Deployment ${deployment.id} failed:`,
      err instanceof Error ? err.message : String(err)
    );
  }
}

/* ──────────────────────── Poll Loop ──────────────────────── */

async function pollQueue(): Promise<void> {
  try {
    const job = await claimNextQueuedDeploymentForExecution({
      actorId: "execution-worker",
      actorEmail: "system@daoflow.local",
      actorRole: "admin",
      actorLabel: "execution-worker"
    });

    if (!job) return;

    await executeDeployment(job);
  } catch (err) {
    console.error(
      "[worker] Unhandled error in poll loop:",
      err instanceof Error ? err.message : String(err)
    );
  }
}

/**
 * Start the execution worker. Polls the database for queued
 * deployments and executes them sequentially.
 */
export function startWorker(): void {
  if (running) {
    console.warn("[worker] Worker already running, skipping duplicate start");
    return;
  }

  running = true;
  console.log(`[worker] Execution worker started (poll interval: ${POLL_INTERVAL_MS}ms)`);

  const poll = async () => {
    while (running) {
      await pollQueue();
      await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    }
  };

  void poll();
}

/**
 * Stop the execution worker gracefully.
 */
export function stopWorker(): void {
  running = false;
  console.log("[worker] Execution worker stopping");
}
