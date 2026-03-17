/**
 * deploy-activities.ts
 *
 * Temporal activities for deployment execution. Each activity is a
 * side-effectful function that wraps existing Docker/DB operations.
 *
 * Activities are NOT deterministic — they perform I/O (Docker commands,
 * DB writes, file operations). The workflow orchestrates them.
 */

import { eq, and, sql as rawSql } from "drizzle-orm";
import { db } from "../../../db/connection";
import { deployments, deploymentSteps } from "../../../db/schema/deployments";
import { auditEntries, events } from "../../../db/schema/audit";
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
} from "../../docker-executor";
import { createLogStreamer } from "../../log-streamer";

// ── Types ────────────────────────────────────────────────────

export interface ConfigSnapshot {
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

export interface DeploymentInfo {
  id: string;
  serviceName: string;
  sourceType: string;
  imageTag: string | null;
  commitSha: string | null;
  configSnapshot: unknown;
}

const HEALTH_CHECK_TIMEOUT_MS = 60_000;
const HEALTH_CHECK_INTERVAL_MS = 3_000;

// ── Step management ──────────────────────────────────────────

async function createStep(deploymentId: string, label: string, sortOrder: number): Promise<number> {
  const [step] = await db
    .insert(deploymentSteps)
    .values({ deploymentId, label, status: "pending", sortOrder })
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
    .set({ status: "completed", completedAt: new Date(), detail: detail ?? null })
    .where(eq(deploymentSteps.id, stepId));
}

async function markStepFailed(stepId: number, detail: string): Promise<void> {
  await db
    .update(deploymentSteps)
    .set({ status: "failed", completedAt: new Date(), detail })
    .where(eq(deploymentSteps.id, stepId));
}

function readConfig(snapshot: unknown): ConfigSnapshot {
  if (snapshot && typeof snapshot === "object" && !Array.isArray(snapshot)) {
    return snapshot as ConfigSnapshot;
  }
  return {};
}

// ── Exported Activities ──────────────────────────────────────

/**
 * Claim a queued deployment atomically and record an audit entry.
 * Returns null if no deployment is available.
 */
export async function claimQueuedDeployment(): Promise<DeploymentInfo | null> {
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

  if (!job) return null;

  await db.insert(auditEntries).values({
    actorType: "system",
    actorId: "temporal-worker",
    actorEmail: "system@daoflow.local",
    actorRole: "admin",
    targetResource: `deployment/${job.id}`,
    action: "deployment.execute",
    inputSummary: `Temporal worker claimed deployment ${job.id} for ${job.serviceName}`,
    permissionScope: "deploy:start",
    outcome: "success",
    metadata: {
      resourceType: "deployment",
      resourceId: job.id,
      resourceLabel: job.serviceName,
      detail: `Temporal worker claimed deployment ${job.id}`
    }
  });

  return {
    id: job.id,
    serviceName: job.serviceName,
    sourceType: job.sourceType,
    imageTag: job.imageTag,
    commitSha: job.commitSha,
    configSnapshot: job.configSnapshot
  };
}

/**
 * Transition a deployment's status in the database.
 */
export async function transitionDeployment(
  id: string,
  status: string,
  conclusion?: string,
  errorMessage?: string
): Promise<void> {
  const now = new Date();
  const update: Record<string, unknown> = { status, updatedAt: now };
  if (conclusion) {
    update.conclusion = conclusion;
    update.concludedAt = now;
  }
  if (errorMessage) {
    update.error = { message: errorMessage };
  }
  await db.update(deployments).set(update).where(eq(deployments.id, id));
}

/**
 * Emit an event to the operations timeline.
 */
export async function emitDeploymentEvent(
  deploymentId: string,
  serviceName: string,
  kind: string,
  summary: string,
  detail: string,
  severity: "info" | "error" = "info"
): Promise<void> {
  await db.insert(events).values({
    kind,
    resourceType: "deployment",
    resourceId: deploymentId,
    summary,
    detail,
    severity,
    metadata: { serviceName, actorLabel: "temporal-worker" },
    createdAt: new Date()
  });
}

/**
 * Execute a compose deployment (clone → pull → up → health).
 */
export async function executeComposeDeployment(deployment: DeploymentInfo): Promise<void> {
  const config = readConfig(deployment.configSnapshot);
  const projectName = config.projectName ?? deployment.serviceName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const { onLog, flush } = createLogStreamer(deployment.id, "temporal-worker");

  const repoUrl = config.repoUrl ?? "";
  const branch = config.branch ?? "main";
  const composeFile = config.composeFilePath ?? "docker-compose.yml";

  try {
    // Clone / prepare workspace
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
      workDir = ensureStagingDir(deployment.id);
      onLog({
        stream: "stdout",
        message: "No repository URL configured, using staging directory",
        timestamp: new Date()
      });
    }
    await markStepComplete(cloneStepId, `Workspace ready at ${workDir}`);

    // Pull images
    const pullStepId = await createStep(deployment.id, "Pull images", 2);
    await markStepRunning(pullStepId);
    const pullResult = await dockerComposePull(composeFile, projectName, workDir, onLog);
    if (pullResult.exitCode !== 0) {
      await markStepFailed(
        pullStepId,
        `docker compose pull exited with code ${pullResult.exitCode}`
      );
      throw new Error(`docker compose pull failed with exit code ${pullResult.exitCode}`);
    }
    await markStepComplete(pullStepId, "All images pulled");

    // Start services
    await transitionDeployment(deployment.id, "deploy");
    const deployStepId = await createStep(deployment.id, "Start services", 3);
    await markStepRunning(deployStepId);
    const upResult = await dockerComposeUp(composeFile, projectName, workDir, onLog);
    if (upResult.exitCode !== 0) {
      await markStepFailed(deployStepId, `docker compose up exited with code ${upResult.exitCode}`);
      throw new Error(`docker compose up failed with exit code ${upResult.exitCode}`);
    }
    await markStepComplete(deployStepId, "Compose services started");

    // Health check
    const healthStepId = await createStep(deployment.id, "Health check", 4);
    await markStepRunning(healthStepId);
    await markStepComplete(healthStepId, "Compose services are running (compose-managed health)");
  } finally {
    await flush();
  }
}

/**
 * Execute a Dockerfile deployment (clone → build → run → health).
 */
export async function executeDockerfileDeployment(deployment: DeploymentInfo): Promise<void> {
  const config = readConfig(deployment.configSnapshot);
  const projectName = config.projectName ?? deployment.serviceName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const containerName = `${projectName}-${deployment.serviceName}`.toLowerCase();
  const { onLog, flush } = createLogStreamer(deployment.id, "temporal-worker");

  const repoUrl = config.repoUrl ?? "";
  const branch = config.branch ?? "main";
  const dockerfile = config.dockerfile ?? "Dockerfile";
  const buildContext = config.buildContext ?? ".";
  const tag =
    deployment.imageTag ?? `daoflow/${deployment.serviceName}:${deployment.commitSha ?? "latest"}`;

  try {
    // Clone
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

    // Build
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

    // Run container
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
    await db
      .update(deployments)
      .set({ containerId: containerName })
      .where(eq(deployments.id, deployment.id));
    await markStepComplete(runStepId, `Container ${containerName} started`);

    // Health check
    await waitForHealthy(deployment.id, containerName, onLog);
  } finally {
    await flush();
  }
}

/**
 * Execute an image deployment (pull → run → health).
 */
export async function executeImageDeployment(deployment: DeploymentInfo): Promise<void> {
  const config = readConfig(deployment.configSnapshot);
  const projectName = config.projectName ?? deployment.serviceName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const containerName = `${projectName}-${deployment.serviceName}`.toLowerCase();
  const { onLog, flush } = createLogStreamer(deployment.id, "temporal-worker");
  const tag = deployment.imageTag ?? "";

  if (!tag) throw new Error("Image deployment requires an imageTag");

  try {
    // Pull
    const pullStepId = await createStep(deployment.id, "Pull image", 1);
    await markStepRunning(pullStepId);
    const pullResult = await dockerPull(tag, onLog);
    if (pullResult.exitCode !== 0) {
      await markStepFailed(pullStepId, `docker pull exited with code ${pullResult.exitCode}`);
      throw new Error(`docker pull failed with exit code ${pullResult.exitCode}`);
    }
    await markStepComplete(pullStepId, `Image ${tag} pulled`);

    // Run
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

    // Health check
    await waitForHealthy(deployment.id, containerName, onLog);
  } finally {
    await flush();
  }
}

/**
 * Wait for a container to become healthy, or throw on timeout.
 */
async function waitForHealthy(
  deploymentId: string,
  containerName: string,
  onLog: OnLog
): Promise<void> {
  const healthStepId = await createStep(deploymentId, "Health check", 10);
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

/**
 * Clean up staging directory for a deployment.
 */
export function cleanupDeploymentStaging(deploymentId: string): Promise<void> {
  cleanupStagingDir(deploymentId);
  return Promise.resolve();
}
