/**
 * worker.ts
 *
 * The deployment execution worker. Polls the database for queued deployments,
 * orchestrates the deployment lifecycle, and streams logs in real time.
 *
 * MVP: runs in-process with the server, uses local Docker socket.
 * Future: extract to a separate process, add SSH-based remote execution.
 */

import { eq, and, asc, sql as rawSql } from "drizzle-orm";
import { db } from "../db/connection";
import { deployments, deploymentSteps } from "../db/schema/deployments";
import { auditEntries, events } from "../db/schema/audit";
import {
  gitClone,
  dockerBuild,
  dockerPull,
  dockerComposePull,
  dockerComposeUp,
  dockerRun,
  checkContainerHealth,
  cleanupStagingDir,
  ensureStagingDir,
  type OnLog
} from "./docker-executor";
import { createLogStreamer } from "./log-streamer";

const POLL_INTERVAL_MS = 5_000;
const HEALTH_CHECK_TIMEOUT_MS = 60_000;
const HEALTH_CHECK_INTERVAL_MS = 3_000;

let running = false;

type DeploymentRow = typeof deployments.$inferSelect;

// ────────────────────────────────────────────────────────────
//  Step management helpers
// ────────────────────────────────────────────────────────────

async function createStep(deploymentId: string, label: string, sortOrder: number): Promise<number> {
  const [step] = await db
    .insert(deploymentSteps)
    .values({
      deploymentId,
      label,
      status: "pending",
      sortOrder
    })
    .returning({ id: deploymentSteps.id });
  return step.id;
}

async function markStepRunning(stepId: number): Promise<void> {
  await db
    .update(deploymentSteps)
    .set({ status: "running", startedAt: new Date() })
    .where(eq(deploymentSteps.id, stepId));
}

async function markStepComplete(stepId: number, detail?: string): Promise<void> {
  await db
    .update(deploymentSteps)
    .set({
      status: "completed",
      completedAt: new Date(),
      detail: detail ?? null
    })
    .where(eq(deploymentSteps.id, stepId));
}

async function markStepFailed(stepId: number, detail: string): Promise<void> {
  await db
    .update(deploymentSteps)
    .set({
      status: "failed",
      completedAt: new Date(),
      detail
    })
    .where(eq(deploymentSteps.id, stepId));
}

// ────────────────────────────────────────────────────────────
//  Deployment status transitions
// ────────────────────────────────────────────────────────────

async function transitionDeployment(
  id: string,
  status: string,
  conclusion?: string,
  error?: unknown
): Promise<void> {
  const now = new Date();
  const update: Record<string, unknown> = {
    status,
    updatedAt: now
  };

  if (conclusion) {
    update.conclusion = conclusion;
    update.concludedAt = now;
  }

  if (error) {
    update.error =
      error instanceof Error
        ? { message: error.message, stack: error.stack }
        : { message: typeof error === "string" ? error : JSON.stringify(error) };
  }

  await db.update(deployments).set(update).where(eq(deployments.id, id));
}

async function emitEvent(
  kind: string,
  deployment: DeploymentRow,
  summary: string,
  detail: string,
  severity: "info" | "error" = "info"
): Promise<void> {
  await db.insert(events).values({
    kind,
    resourceType: "deployment",
    resourceId: deployment.id,
    summary,
    detail,
    severity,
    metadata: {
      serviceName: deployment.serviceName,
      actorLabel: "execution-worker"
    },
    createdAt: new Date()
  });
}

// ────────────────────────────────────────────────────────────
//  Deployment execution — the core logic
// ────────────────────────────────────────────────────────────

interface ConfigSnapshot {
  projectName?: string;
  environmentName?: string;
  targetServerName?: string;
  composeFilePath?: string;
  repoUrl?: string;
  branch?: string;
  dockerfile?: string;
  buildContext?: string;
  ports?: string[];
  volumes?: string[];
  env?: Record<string, string>;
  network?: string;
}

function readConfig(deployment: DeploymentRow): ConfigSnapshot {
  const raw = deployment.configSnapshot;
  if (raw && typeof raw === "object" && !Array.isArray(raw)) {
    return raw as ConfigSnapshot;
  }
  return {};
}

async function executeDeployment(deployment: DeploymentRow): Promise<void> {
  const config = readConfig(deployment);
  const { onLog, flush } = createLogStreamer(deployment.id, "worker");

  const projectName = config.projectName ?? deployment.serviceName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const containerName = `${projectName}-${deployment.serviceName}`.toLowerCase();

  console.log(
    `[worker] Executing deployment ${deployment.id} for ${deployment.serviceName} (${deployment.sourceType})`
  );

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
      await executeComposeDeployment(deployment, config, projectName, onLog);
    } else if (deployment.sourceType === "dockerfile") {
      await executeDockerfileDeployment(deployment, config, containerName, onLog);
    } else if (deployment.sourceType === "image") {
      await executeImageDeployment(deployment, config, containerName, onLog);
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

// ── Compose deployment ────────────────────────────────────

async function executeComposeDeployment(
  deployment: DeploymentRow,
  config: ConfigSnapshot,
  projectName: string,
  onLog: OnLog
): Promise<void> {
  const repoUrl = config.repoUrl ?? "";
  const branch = config.branch ?? "main";
  const composeFile = config.composeFilePath ?? "docker-compose.yml";

  // Step 1: Clone / prepare workspace
  const cloneStepId = await createStep(deployment.id, "Clone repository", 1);
  await markStepRunning(cloneStepId);

  let workDir: string;
  if (repoUrl) {
    const result = await gitClone(repoUrl, branch, deployment.id, onLog);
    if (result.exitCode !== 0) {
      await markStepFailed(cloneStepId, `git clone exited with code ${result.exitCode}`);
      throw new Error(`git clone failed with exit code ${result.exitCode}`);
    }
    workDir = result.workDir;
  } else {
    // No repo — just create staging dir (compose file might come from config)
    workDir = ensureStagingDir(deployment.id);
    onLog({
      stream: "stdout",
      message: "No repository URL configured, using staging directory",
      timestamp: new Date()
    });
  }
  await markStepComplete(cloneStepId, `Workspace ready at ${workDir}`);

  // Step 2: Pull images
  const pullStepId = await createStep(deployment.id, "Pull images", 2);
  await markStepRunning(pullStepId);

  const pullResult = await dockerComposePull(composeFile, projectName, workDir, onLog);
  if (pullResult.exitCode !== 0) {
    await markStepFailed(pullStepId, `docker compose pull exited with code ${pullResult.exitCode}`);
    throw new Error(`docker compose pull failed with exit code ${pullResult.exitCode}`);
  }
  await markStepComplete(pullStepId, "All images pulled");

  // Step 3: Deploy
  await transitionDeployment(deployment.id, "deploy");
  const deployStepId = await createStep(deployment.id, "Start services", 3);
  await markStepRunning(deployStepId);

  const upResult = await dockerComposeUp(composeFile, projectName, workDir, onLog);
  if (upResult.exitCode !== 0) {
    await markStepFailed(deployStepId, `docker compose up exited with code ${upResult.exitCode}`);
    throw new Error(`docker compose up failed with exit code ${upResult.exitCode}`);
  }
  await markStepComplete(deployStepId, "Compose services started");

  // Step 4: Health check
  const healthStepId = await createStep(deployment.id, "Health check", 4);
  await markStepRunning(healthStepId);
  await markStepComplete(healthStepId, "Compose services are running (compose-managed health)");
}

// ── Dockerfile deployment ─────────────────────────────────

async function executeDockerfileDeployment(
  deployment: DeploymentRow,
  config: ConfigSnapshot,
  containerName: string,
  onLog: OnLog
): Promise<void> {
  const repoUrl = config.repoUrl ?? "";
  const branch = config.branch ?? "main";
  const dockerfile = config.dockerfile ?? "Dockerfile";
  const buildContext = config.buildContext ?? ".";
  const tag =
    deployment.imageTag ?? `daoflow/${deployment.serviceName}:${deployment.commitSha ?? "latest"}`;

  // Step 1: Clone
  const cloneStepId = await createStep(deployment.id, "Clone repository", 1);
  await markStepRunning(cloneStepId);

  if (!repoUrl) {
    await markStepFailed(cloneStepId, "No repository URL provided for Dockerfile deployment");
    throw new Error("Dockerfile deployment requires a repository URL");
  }

  const cloneResult = await gitClone(repoUrl, branch, deployment.id, onLog);
  if (cloneResult.exitCode !== 0) {
    await markStepFailed(cloneStepId, `git clone exited with code ${cloneResult.exitCode}`);
    throw new Error(`git clone failed with exit code ${cloneResult.exitCode}`);
  }
  await markStepComplete(cloneStepId, `Repository cloned to ${cloneResult.workDir}`);

  // Step 2: Build
  const buildStepId = await createStep(deployment.id, "Build image", 2);
  await markStepRunning(buildStepId);
  await transitionDeployment(deployment.id, "deploy");

  const absoluteContext = `${cloneResult.workDir}/${buildContext}`.replace("//", "/");
  const absoluteDockerfile = `${cloneResult.workDir}/${dockerfile}`.replace("//", "/");

  const buildResult = await dockerBuild(absoluteContext, absoluteDockerfile, tag, onLog);
  if (buildResult.exitCode !== 0) {
    await markStepFailed(buildStepId, `docker build exited with code ${buildResult.exitCode}`);
    throw new Error(`docker build failed with exit code ${buildResult.exitCode}`);
  }
  await markStepComplete(buildStepId, `Image ${tag} built successfully`);

  // Step 3: Run container
  const runStepId = await createStep(deployment.id, "Start container", 3);
  await markStepRunning(runStepId);

  const runResult = await dockerRun(
    tag,
    containerName,
    {
      ports: config.ports ?? [],
      volumes: config.volumes ?? [],
      env: config.env ?? {},
      network: config.network
    },
    onLog
  );
  if (runResult.exitCode !== 0) {
    await markStepFailed(runStepId, `docker run exited with code ${runResult.exitCode}`);
    throw new Error(`docker run failed with exit code ${runResult.exitCode}`);
  }

  // Update container ID
  await db
    .update(deployments)
    .set({ containerId: containerName })
    .where(eq(deployments.id, deployment.id));

  await markStepComplete(runStepId, `Container ${containerName} started`);

  // Step 4: Health check
  await waitForHealthy(deployment, containerName, onLog);
}

// ── Image deployment ──────────────────────────────────────

async function executeImageDeployment(
  deployment: DeploymentRow,
  config: ConfigSnapshot,
  containerName: string,
  onLog: OnLog
): Promise<void> {
  const tag = deployment.imageTag ?? "";
  if (!tag) {
    throw new Error("Image deployment requires an imageTag");
  }

  // Step 1: Pull image
  const pullStepId = await createStep(deployment.id, "Pull image", 1);
  await markStepRunning(pullStepId);

  const pullResult = await dockerPull(tag, onLog);
  if (pullResult.exitCode !== 0) {
    await markStepFailed(pullStepId, `docker pull exited with code ${pullResult.exitCode}`);
    throw new Error(`docker pull failed with exit code ${pullResult.exitCode}`);
  }
  await markStepComplete(pullStepId, `Image ${tag} pulled`);

  // Step 2: Start container
  await transitionDeployment(deployment.id, "deploy");
  const runStepId = await createStep(deployment.id, "Start container", 2);
  await markStepRunning(runStepId);

  const runResult = await dockerRun(
    tag,
    containerName,
    {
      ports: config.ports ?? [],
      volumes: config.volumes ?? [],
      env: config.env ?? {},
      network: config.network
    },
    onLog
  );
  if (runResult.exitCode !== 0) {
    await markStepFailed(runStepId, `docker run exited with code ${runResult.exitCode}`);
    throw new Error(`docker run failed with exit code ${runResult.exitCode}`);
  }

  await db
    .update(deployments)
    .set({ containerId: containerName })
    .where(eq(deployments.id, deployment.id));

  await markStepComplete(runStepId, `Container ${containerName} started`);

  // Step 3: Health check
  await waitForHealthy(deployment, containerName, onLog);
}

// ── Health check helper ───────────────────────────────────

async function waitForHealthy(
  deployment: DeploymentRow,
  containerName: string,
  onLog: OnLog
): Promise<void> {
  const healthStepId = await createStep(deployment.id, "Health check", 10);
  await markStepRunning(healthStepId);

  const start = Date.now();
  while (Date.now() - start < HEALTH_CHECK_TIMEOUT_MS) {
    const healthy = await checkContainerHealth(containerName, onLog);
    if (healthy) {
      await markStepComplete(healthStepId, `Container ${containerName} is healthy`);
      return;
    }
    await new Promise((resolve) => setTimeout(resolve, HEALTH_CHECK_INTERVAL_MS));
  }

  await markStepFailed(
    healthStepId,
    `Container ${containerName} did not become healthy within ${HEALTH_CHECK_TIMEOUT_MS / 1000}s`
  );
  throw new Error(`Health check timeout for ${containerName}`);
}

// ────────────────────────────────────────────────────────────
//  Worker loop
// ────────────────────────────────────────────────────────────

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
