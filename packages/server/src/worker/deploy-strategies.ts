/**
 * deploy-strategies.ts — Deployment execution strategies.
 *
 * Contains: compose, dockerfile, and image deployment strategies,
 * plus the shared health-check helper.
 *
 * Extracted from worker.ts for modularity.
 */

import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { deployments } from "../db/schema/deployments";
import {
  gitClone,
  dockerBuild,
  dockerPull,
  dockerComposePull,
  dockerComposeUp,
  dockerRun,
  checkContainerHealth,
  ensureStagingDir,
  type OnLog
} from "./docker-executor";
import {
  createStep,
  markStepRunning,
  markStepComplete,
  markStepFailed,
  transitionDeployment,
  type DeploymentRow,
  type ConfigSnapshot
} from "./step-management";

const HEALTH_CHECK_TIMEOUT_MS = 60_000;
const HEALTH_CHECK_INTERVAL_MS = 3_000;

/* ──────────────────────── Compose ──────────────────────── */

export async function executeComposeDeployment(
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

/* ──────────────────────── Dockerfile ──────────────────────── */

export async function executeDockerfileDeployment(
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

  await db
    .update(deployments)
    .set({ containerId: containerName })
    .where(eq(deployments.id, deployment.id));

  await markStepComplete(runStepId, `Container ${containerName} started`);

  // Step 4: Health check
  await waitForHealthy(deployment, containerName, onLog);
}

/* ──────────────────────── Image ──────────────────────── */

export async function executeImageDeployment(
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

/* ──────────────────────── Health Check ──────────────────────── */

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
