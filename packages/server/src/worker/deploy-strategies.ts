import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { deployments } from "../db/schema/deployments";
import {
  listAllContainerRegistryCredentials,
  listContainerRegistryCredentialsByImageReferences
} from "../db/services/container-registries";
import {
  gitClone,
  dockerBuild,
  dockerPull,
  dockerRun,
  checkContainerHealth,
  createTarArchive,
  getStagingArchivePath,
  type OnLog
} from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import {
  remoteCheckContainerHealth,
  remoteDockerBuild,
  remoteDockerPull,
  remoteDockerRun,
  remoteEnsureDir,
  remoteExtractArchive,
  scpUpload
} from "./ssh-executor";
export { executeComposeDeployment } from "./compose-deploy-strategy";
import { resolveCheckoutSpec } from "./checkout-source";
import {
  createStep,
  markStepRunning,
  markStepComplete,
  markStepFailed,
  transitionDeployment,
  type DeploymentRow,
  type ConfigSnapshot
} from "./step-management";
import { throwIfDeploymentCancellationRequested } from "../db/services/deployment-execution-control";

const HEALTH_CHECK_TIMEOUT_MS = 60_000;
const HEALTH_CHECK_INTERVAL_MS = 3_000;
export async function executeDockerfileDeployment(
  deployment: DeploymentRow,
  config: ConfigSnapshot,
  containerName: string,
  onLog: OnLog,
  target: ExecutionTarget
): Promise<void> {
  const dockerfile = config.dockerfile ?? "Dockerfile";
  const buildContext = config.buildContext ?? ".";
  const tag =
    deployment.imageTag ?? `daoflow/${deployment.serviceName}:${deployment.commitSha ?? "latest"}`;
  const registryCredentials = await listAllContainerRegistryCredentials();

  await throwIfDeploymentCancellationRequested(deployment.id);

  // Step 1: Clone
  const cloneStepId = await createStep(deployment.id, "Clone repository", 1);
  await markStepRunning(cloneStepId);

  const checkout = await resolveCheckoutSpec(config);
  if (!checkout) {
    await markStepFailed(cloneStepId, "No repository URL provided for Dockerfile deployment");
    throw new Error("Dockerfile deployment requires a repository URL");
  }

  const cloneResult = await gitClone(checkout.repoUrl, checkout.branch, deployment.id, onLog, {
    displayLabel: checkout.displayLabel,
    gitConfig: checkout.gitConfig,
    sshPrivateKey: checkout.sshPrivateKey,
    repositoryPreparation: checkout.repositoryPreparation,
    commitSha: deployment.commitSha ?? undefined
  });
  if (cloneResult.exitCode !== 0) {
    await markStepFailed(cloneStepId, `git clone exited with code ${cloneResult.exitCode}`);
    throw new Error(`git clone failed with exit code ${cloneResult.exitCode}`);
  }
  let workDir = cloneResult.workDir;
  if (target.mode === "remote") {
    const localArchivePath = getStagingArchivePath(deployment.id);
    const remoteArchivePath = `${target.remoteWorkDir}/${deployment.id}.tar.gz`;
    const archiveResult = await createTarArchive(cloneResult.workDir, localArchivePath, onLog);
    if (archiveResult.exitCode !== 0) {
      await markStepFailed(cloneStepId, `tar archive exited with code ${archiveResult.exitCode}`);
      throw new Error(`tar archive creation failed with exit code ${archiveResult.exitCode}`);
    }
    const ensureDirResult = await remoteEnsureDir(target.ssh, target.remoteWorkDir, onLog);
    if (ensureDirResult.exitCode !== 0) {
      await markStepFailed(cloneStepId, "Remote workspace preparation failed");
      throw new Error(`Failed to prepare remote workspace ${target.remoteWorkDir}.`);
    }
    const uploadArchive = await scpUpload(target.ssh, localArchivePath, remoteArchivePath, onLog);
    if (uploadArchive.exitCode !== 0) {
      await markStepFailed(cloneStepId, "Repository archive upload failed");
      throw new Error(`Failed to upload repository archive for deployment ${deployment.id}.`);
    }
    const extractRemote = await remoteExtractArchive(
      target.ssh,
      remoteArchivePath,
      target.remoteWorkDir,
      onLog
    );
    if (extractRemote.exitCode !== 0) {
      await markStepFailed(cloneStepId, "Repository archive extraction failed");
      throw new Error(`Failed to extract repository archive for deployment ${deployment.id}.`);
    }
    workDir = target.remoteWorkDir;
  }
  await markStepComplete(cloneStepId, `Repository cloned to ${workDir}`);
  await throwIfDeploymentCancellationRequested(deployment.id);

  // Step 2: Build
  const buildStepId = await createStep(deployment.id, "Build image", 2);
  await markStepRunning(buildStepId);
  await transitionDeployment(deployment.id, "deploy");

  const absoluteContext = `${workDir}/${buildContext}`.replace("//", "/");
  const absoluteDockerfile = `${workDir}/${dockerfile}`.replace("//", "/");

  const buildResult =
    target.mode === "remote"
      ? await remoteDockerBuild(
          target.ssh,
          absoluteContext,
          absoluteDockerfile,
          tag,
          onLog,
          registryCredentials
        )
      : await dockerBuild(absoluteContext, absoluteDockerfile, tag, onLog, registryCredentials);
  if (buildResult.exitCode !== 0) {
    await markStepFailed(buildStepId, `docker build exited with code ${buildResult.exitCode}`);
    throw new Error(`docker build failed with exit code ${buildResult.exitCode}`);
  }
  await markStepComplete(buildStepId, `Image ${tag} built successfully`);
  await throwIfDeploymentCancellationRequested(deployment.id);

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
  await throwIfDeploymentCancellationRequested(deployment.id);

  // Step 4: Health check
  await waitForHealthy(deployment, containerName, onLog, target);
}

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

  await throwIfDeploymentCancellationRequested(deployment.id);
  const registryCredentials = await listContainerRegistryCredentialsByImageReferences([tag]);

  // Step 1: Pull image
  const pullStepId = await createStep(deployment.id, "Pull image", 1);
  await markStepRunning(pullStepId);

  const pullResult =
    target.mode === "remote"
      ? await remoteDockerPull(target.ssh, tag, onLog, registryCredentials)
      : await dockerPull(tag, onLog, registryCredentials);
  if (pullResult.exitCode !== 0) {
    await markStepFailed(pullStepId, `docker pull exited with code ${pullResult.exitCode}`);
    throw new Error(`docker pull failed with exit code ${pullResult.exitCode}`);
  }
  await markStepComplete(pullStepId, `Image ${tag} pulled`);
  await throwIfDeploymentCancellationRequested(deployment.id);

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
  await throwIfDeploymentCancellationRequested(deployment.id);

  // Step 3: Health check
  await waitForHealthy(deployment, containerName, onLog, target);
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
    await throwIfDeploymentCancellationRequested(deployment.id);
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
