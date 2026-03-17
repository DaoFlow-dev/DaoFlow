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

import { eq, and, sql as rawSql } from "drizzle-orm";
import { db } from "../db/connection";
import { deployments } from "../db/schema/deployments";
import { auditEntries } from "../db/schema/audit";
import type { DeploymentRow } from "./step-management";
import { runDeployment } from "./run-deployment";

const POLL_INTERVAL_MS = 5_000;
let running = false;

/* ──────────────────────── Deployment Execution ──────────────────────── */

async function executeDeployment(deployment: DeploymentRow): Promise<void> {
  try {
    console.log(`[worker] Executing deployment ${deployment.id} for ${deployment.serviceName}`);
    await runDeployment(deployment, "execution-worker");
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
    // Atomic claim: UPDATE the oldest queued deployment to "prepare" in one
    // statement. If two workers poll at the same time, only one succeeds
    // because the WHERE clause filters by status = "queued".
    const [job] = await db
      .update(deployments)
      .set({ status: "prepare", updatedAt: new Date() })
      .where(
        and(
          eq(deployments.status, "queued"),
          eq(
            deployments.id,
            rawSql`(SELECT id FROM ${deployments} WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED)`
          )
        )
      )
      .returning();

    if (!job) return;

    // Record audit entry
    await db.insert(auditEntries).values({
      actorType: "system",
      actorId: "execution-worker",
      actorEmail: "system@daoflow.local",
      actorRole: "admin",
      targetResource: `deployment/${job.id}`,
      action: "deployment.execute",
      inputSummary: `Worker picked up deployment ${job.id} for ${job.serviceName}`,
      permissionScope: "deploy:start",
      outcome: "success",
      metadata: {
        resourceType: "deployment",
        resourceId: job.id,
        resourceLabel: job.serviceName,
        detail: `Execution worker claimed deployment ${job.id}`
      }
    });

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
