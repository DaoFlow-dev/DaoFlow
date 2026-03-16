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
import { cleanupStagingDir } from "./docker-executor";
import { createLogStreamer } from "./log-streamer";
import { transitionDeployment, emitEvent, readConfig, type DeploymentRow } from "./step-management";
import {
  executeComposeDeployment,
  executeDockerfileDeployment,
  executeImageDeployment
} from "./deploy-strategies";

const POLL_INTERVAL_MS = 5_000;
const DEPLOY_TIMEOUT_MS = Number(process.env.DEPLOY_TIMEOUT_MS ?? 600_000); // 10 min default

let running = false;

/* ──────────────────────── Deployment Execution ──────────────────────── */

async function executeDeployment(deployment: DeploymentRow): Promise<void> {
  const config = readConfig(deployment);
  const { onLog, flush } = createLogStreamer(deployment.id, "worker");

  const projectName = config.projectName ?? deployment.serviceName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const containerName = `${projectName}-${deployment.serviceName}`.toLowerCase();

  console.log(
    `[worker] Executing deployment ${deployment.id} for ${deployment.serviceName} (${deployment.sourceType})`
  );

  // Wrap execution with a timeout (T-26: deployment timeout)
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`Deployment timed out after ${DEPLOY_TIMEOUT_MS / 1000}s`)),
      DEPLOY_TIMEOUT_MS
    );
  });

  try {
    // ── Phase 1: Prepare ──────────────────────────────────
    await transitionDeployment(deployment.id, "prepare");
    await emitEvent(
      "deployment.prepare.started",
      deployment,
      "Deployment preparation started",
      `Worker began preparing ${deployment.serviceName}`
    );

    if (deployment.sourceType === "compose") {
      await Promise.race([
        executeComposeDeployment(deployment, config, projectName, onLog),
        timeoutPromise
      ]);
    } else if (deployment.sourceType === "dockerfile") {
      await Promise.race([
        executeDockerfileDeployment(deployment, config, containerName, onLog),
        timeoutPromise
      ]);
    } else if (deployment.sourceType === "image") {
      await Promise.race([
        executeImageDeployment(deployment, config, containerName, onLog),
        timeoutPromise
      ]);
    } else {
      throw new Error(`Unsupported source type: ${deployment.sourceType}`);
    }

    // ── Phase 4: Finalize ─────────────────────────────────
    await transitionDeployment(deployment.id, "completed", "succeeded");
    await emitEvent(
      "deployment.succeeded",
      deployment,
      "Deployment completed successfully",
      `${deployment.serviceName} is now running`
    );

    console.log(`[worker] Deployment ${deployment.id} completed successfully`);
  } catch (err) {
    console.error(
      `[worker] Deployment ${deployment.id} failed:`,
      err instanceof Error ? err.message : String(err)
    );

    await transitionDeployment(deployment.id, "failed", "failed", err);
    await emitEvent(
      "deployment.failed",
      deployment,
      "Deployment failed",
      err instanceof Error ? err.message : String(err),
      "error"
    );
  } finally {
    await flush();
    cleanupStagingDir(deployment.id);
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
