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
import { COMPOSE_ENV_FILE_NAME } from "../compose-env";
import { readComposeReadinessProbeSnapshot } from "../compose-readiness";
import {
  persistDeploymentComposeEnvState,
  readDeploymentComposeState
} from "../db/services/compose-env";
import { assessComposeHealth, type ComposeContainerStatus } from "./compose-health";
import {
  runLocalComposeReadinessCheck,
  runRemoteComposeReadinessCheck
} from "./compose-readiness-check";
import {
  gitClone,
  dockerBuild,
  dockerComposePs,
  dockerPull,
  dockerComposePull,
  dockerComposeUp,
  dockerRun,
  checkContainerHealth,
  ensureStagingDir,
  type OnLog
} from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import {
  remoteCheckContainerHealth,
  remoteDockerBuild,
  remoteDockerComposePs,
  remoteDockerComposePull,
  remoteDockerComposeUp,
  remoteDockerPull,
  remoteDockerRun,
  remoteGitClone
} from "./ssh-executor";
import { prepareComposeWorkspace } from "./compose-workspace";
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
  onLog: OnLog,
  target: ExecutionTarget
): Promise<void> {
  const uploadedSource =
    config.deploymentSource === "uploaded-compose" ||
    config.deploymentSource === "uploaded-context";
  const composeServiceName =
    typeof config.composeServiceName === "string" && config.composeServiceName.trim().length > 0
      ? config.composeServiceName.trim()
      : undefined;
  const composeTargetLabel = composeServiceName
    ? `compose service ${composeServiceName}`
    : "compose services";
  const readinessProbe = readComposeReadinessProbeSnapshot(config.readinessProbe);

  // Step 1: Clone / prepare workspace
  const cloneStepId = await createStep(
    deployment.id,
    uploadedSource ? "Prepare uploaded workspace" : "Clone repository",
    1
  );
  await markStepRunning(cloneStepId);

  let workDir: string;
  let composeFile: string;
  let composeEnvFile: string | undefined;
  const deploymentComposeState = readDeploymentComposeState(deployment.envVarsEncrypted);
  try {
    const workspace = await prepareComposeWorkspace(
      deployment.id,
      config,
      target,
      onLog,
      deploymentComposeState,
      deployment.commitSha ?? undefined
    );
    workDir = workspace.workDir;
    composeFile = workspace.composeFile;
    composeEnvFile = COMPOSE_ENV_FILE_NAME;
    await persistDeploymentComposeEnvState({
      deploymentId: deployment.id,
      envEntries: workspace.composeEnv.payloadEntries,
      composeEnv: workspace.composeEnv.composeEnv,
      composeInputs: workspace.composeInputs.manifest,
      frozenInputs: workspace.composeInputs.frozenInputs
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markStepFailed(cloneStepId, message);
    throw error;
  }
  await markStepComplete(cloneStepId, `Workspace ready at ${workDir}`);

  // Step 2: Pull images
  const pullStepId = await createStep(
    deployment.id,
    composeServiceName ? `Pull images for ${composeServiceName}` : "Pull images",
    2
  );
  await markStepRunning(pullStepId);

  const pullResult =
    target.mode === "remote"
      ? await remoteDockerComposePull(
          target.ssh,
          composeFile,
          projectName,
          workDir,
          onLog,
          composeEnvFile,
          composeServiceName
        )
      : await dockerComposePull(
          composeFile,
          projectName,
          workDir,
          onLog,
          composeEnvFile,
          composeServiceName
        );
  if (pullResult.exitCode !== 0) {
    await markStepFailed(pullStepId, `docker compose pull exited with code ${pullResult.exitCode}`);
    throw new Error(`docker compose pull failed with exit code ${pullResult.exitCode}`);
  }
  await markStepComplete(pullStepId, `Pulled images for ${composeTargetLabel}`);

  // Step 3: Deploy
  await transitionDeployment(deployment.id, "deploy");
  const deployStepId = await createStep(
    deployment.id,
    composeServiceName ? `Start ${composeServiceName}` : "Start services",
    3
  );
  await markStepRunning(deployStepId);

  const upResult =
    target.mode === "remote"
      ? await remoteDockerComposeUp(
          target.ssh,
          composeFile,
          projectName,
          workDir,
          onLog,
          composeEnvFile,
          composeServiceName
        )
      : await dockerComposeUp(
          composeFile,
          projectName,
          workDir,
          onLog,
          composeEnvFile,
          composeServiceName
        );
  if (upResult.exitCode !== 0) {
    await markStepFailed(deployStepId, `docker compose up exited with code ${upResult.exitCode}`);
    throw new Error(`docker compose up failed with exit code ${upResult.exitCode}`);
  }
  await markStepComplete(deployStepId, `Started ${composeTargetLabel}`);

  // Step 4: Health check (verify compose services are running)
  const healthStepId = await createStep(deployment.id, "Health check", 4);
  await markStepRunning(healthStepId);
  await waitForComposeHealthy(
    composeFile,
    projectName,
    workDir,
    composeTargetLabel,
    composeServiceName,
    composeEnvFile,
    onLog,
    target,
    healthStepId,
    readinessProbe
  );
}

/* ──────────────────────── Dockerfile ──────────────────────── */

export async function executeDockerfileDeployment(
  deployment: DeploymentRow,
  config: ConfigSnapshot,
  containerName: string,
  onLog: OnLog,
  target: ExecutionTarget
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

  const workDir = target.mode === "remote" ? target.remoteWorkDir : ensureStagingDir(deployment.id);
  const cloneResult =
    target.mode === "remote"
      ? await remoteGitClone(target.ssh, repoUrl, branch, workDir, onLog)
      : await gitClone(repoUrl, branch, deployment.id, onLog);
  if (cloneResult.exitCode !== 0) {
    await markStepFailed(cloneStepId, `git clone exited with code ${cloneResult.exitCode}`);
    throw new Error(`git clone failed with exit code ${cloneResult.exitCode}`);
  }
  await markStepComplete(cloneStepId, `Repository cloned to ${workDir}`);

  // Step 2: Build
  const buildStepId = await createStep(deployment.id, "Build image", 2);
  await markStepRunning(buildStepId);
  await transitionDeployment(deployment.id, "deploy");

  const absoluteContext = `${workDir}/${buildContext}`.replace("//", "/");
  const absoluteDockerfile = `${workDir}/${dockerfile}`.replace("//", "/");

  const buildResult =
    target.mode === "remote"
      ? await remoteDockerBuild(target.ssh, absoluteContext, absoluteDockerfile, tag, onLog)
      : await dockerBuild(absoluteContext, absoluteDockerfile, tag, onLog);
  if (buildResult.exitCode !== 0) {
    await markStepFailed(buildStepId, `docker build exited with code ${buildResult.exitCode}`);
    throw new Error(`docker build failed with exit code ${buildResult.exitCode}`);
  }
  await markStepComplete(buildStepId, `Image ${tag} built successfully`);

  // Step 3: Run container
  const runStepId = await createStep(deployment.id, "Start container", 3);
  await markStepRunning(runStepId);

  const runResult =
    target.mode === "remote"
      ? await remoteDockerRun(
          target.ssh,
          tag,
          containerName,
          {
            ports: config.ports ?? [],
            volumes: config.volumes ?? [],
            env: config.env ?? {},
            network: config.network
          },
          onLog
        )
      : await dockerRun(
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
  await waitForHealthy(deployment, containerName, onLog, target);
}

/* ──────────────────────── Image ──────────────────────── */

export async function executeImageDeployment(
  deployment: DeploymentRow,
  config: ConfigSnapshot,
  containerName: string,
  onLog: OnLog,
  target: ExecutionTarget
): Promise<void> {
  const tag = deployment.imageTag ?? "";
  if (!tag) {
    throw new Error("Image deployment requires an imageTag");
  }

  // Step 1: Pull image
  const pullStepId = await createStep(deployment.id, "Pull image", 1);
  await markStepRunning(pullStepId);

  const pullResult =
    target.mode === "remote"
      ? await remoteDockerPull(target.ssh, tag, onLog)
      : await dockerPull(tag, onLog);
  if (pullResult.exitCode !== 0) {
    await markStepFailed(pullStepId, `docker pull exited with code ${pullResult.exitCode}`);
    throw new Error(`docker pull failed with exit code ${pullResult.exitCode}`);
  }
  await markStepComplete(pullStepId, `Image ${tag} pulled`);

  // Step 2: Start container
  await transitionDeployment(deployment.id, "deploy");
  const runStepId = await createStep(deployment.id, "Start container", 2);
  await markStepRunning(runStepId);

  const runResult =
    target.mode === "remote"
      ? await remoteDockerRun(
          target.ssh,
          tag,
          containerName,
          {
            ports: config.ports ?? [],
            volumes: config.volumes ?? [],
            env: config.env ?? {},
            network: config.network
          },
          onLog
        )
      : await dockerRun(
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
  await waitForHealthy(deployment, containerName, onLog, target);
}

/* ──────────────────────── Health Check ──────────────────────── */

async function readComposeHealthStatuses(
  composeFile: string,
  projectName: string,
  workDir: string,
  onLog: OnLog,
  target: ExecutionTarget,
  envFile?: string,
  composeServiceName?: string
): Promise<{ exitCode: number; statuses: ComposeContainerStatus[] }> {
  return target.mode === "remote"
    ? remoteDockerComposePs(
        target.ssh,
        composeFile,
        projectName,
        workDir,
        onLog,
        envFile,
        composeServiceName
      )
    : dockerComposePs(composeFile, projectName, workDir, onLog, envFile, composeServiceName);
}

async function waitForComposeHealthy(
  composeFile: string,
  projectName: string,
  workDir: string,
  composeTargetLabel: string,
  composeServiceName: string | undefined,
  composeEnvFile: string | undefined,
  onLog: OnLog,
  target: ExecutionTarget,
  healthStepId: number,
  readinessProbe: ReturnType<typeof readComposeReadinessProbeSnapshot>
): Promise<void> {
  const composeStart = Date.now();
  let readinessStart: number | null = null;
  let lastPendingSummary = `${composeTargetLabel} are still converging`;

  const intervalMs = readinessProbe
    ? readinessProbe.intervalSeconds * 1_000
    : HEALTH_CHECK_INTERVAL_MS;

  while (true) {
    const now = Date.now();
    if (!readinessStart && now - composeStart >= HEALTH_CHECK_TIMEOUT_MS) {
      await markStepFailed(
        healthStepId,
        `Timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s: ${lastPendingSummary}`
      );
      throw new Error(`Health check timeout for ${composeTargetLabel}`);
    }

    if (
      readinessProbe &&
      readinessStart !== null &&
      now - readinessStart >= readinessProbe.timeoutSeconds * 1_000
    ) {
      await markStepFailed(
        healthStepId,
        `Timed out after ${readinessProbe.timeoutSeconds}s: ${lastPendingSummary}`
      );
      throw new Error(`Health check timeout for ${composeTargetLabel}`);
    }

    const statusResult = await readComposeHealthStatuses(
      composeFile,
      projectName,
      workDir,
      onLog,
      target,
      composeEnvFile,
      composeServiceName
    );
    if (statusResult.exitCode !== 0) {
      await markStepFailed(
        healthStepId,
        `docker compose ps exited with code ${statusResult.exitCode}`
      );
      throw new Error(`docker compose ps failed with exit code ${statusResult.exitCode}`);
    }

    const assessment = assessComposeHealth(statusResult.statuses, composeTargetLabel);
    if (assessment.kind === "healthy") {
      if (!readinessProbe) {
        await markStepComplete(healthStepId, assessment.summary);
        return;
      }

      readinessStart ??= Date.now();
      const readinessAttempt =
        target.mode === "remote"
          ? await runRemoteComposeReadinessCheck(target.ssh, readinessProbe, onLog)
          : await runLocalComposeReadinessCheck(readinessProbe);

      if (readinessAttempt.kind === "success") {
        await markStepComplete(healthStepId, `${assessment.summary}; ${readinessAttempt.summary}`);
        return;
      }

      if (readinessAttempt.kind === "failed") {
        await markStepFailed(healthStepId, readinessAttempt.summary);
        throw new Error(readinessAttempt.summary);
      }

      lastPendingSummary = readinessAttempt.summary;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }

    if (assessment.kind === "failed") {
      await markStepFailed(healthStepId, assessment.summary);
      throw new Error(assessment.summary);
    }

    lastPendingSummary = assessment.summary;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}

async function waitForHealthy(
  deployment: DeploymentRow,
  containerName: string,
  onLog: OnLog,
  target: ExecutionTarget
): Promise<void> {
  const healthStepId = await createStep(deployment.id, "Health check", 10);
  await markStepRunning(healthStepId);

  const start = Date.now();
  while (Date.now() - start < HEALTH_CHECK_TIMEOUT_MS) {
    const healthy =
      target.mode === "remote"
        ? await remoteCheckContainerHealth(target.ssh, containerName, onLog)
        : await checkContainerHealth(containerName, onLog);
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
