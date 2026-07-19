import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { deployments } from "../db/schema/deployments";
import {
  listContainerRegistryCredentialsForProject,
  listContainerRegistryCredentialsForProjectImageReferences
} from "../db/services/container-registry-credentials";
import {
  gitClone,
  dockerBuild,
  dockerPull,
  dockerBuildMetadataWrapper,
  createTarArchive,
  getStagingArchivePath,
  type OnLog
} from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import {
  remoteDockerBuild,
  remoteDockerBuildMetadataWrapper,
  remoteDockerPull,
  remoteEnsureDir,
  remoteExtractArchive,
  scpUpload
} from "./ssh-executor";
export { executeComposeDeployment } from "./compose-deploy-strategy";
export {
  executeBuildpackDeployment,
  executeNixpacksDeployment
} from "./deploy-strategies-build-tools";
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
import { withDeploymentBuildLease } from "./deployment-build-lease";
import { buildDockerOwnershipLabels, type DockerOwnershipIdentity } from "../docker-ownership";
import { runOwnedDockerContainer } from "./direct-docker-run";
import { waitForDirectDeploymentHealth } from "./direct-deployment-health";

function buildOwnedImageTag(deploymentId: string): string {
  return `daoflow-owned:${deploymentId}`;
}
export async function executeDockerfileDeployment(
  deployment: DeploymentRow,
  config: ConfigSnapshot,
  containerName: string,
  ownership: DockerOwnershipIdentity,
  onLog: OnLog,
  target: ExecutionTarget,
  signal?: AbortSignal
): Promise<void> {
  const dockerfile = config.dockerfile ?? "Dockerfile";
  const buildContext = config.buildContext ?? ".";
  const tag =
    deployment.imageTag ?? `daoflow/${deployment.serviceName}:${deployment.commitSha ?? "latest"}`;
  const registryCredentials = await listContainerRegistryCredentialsForProject(
    deployment.projectId
  );

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
    commitSha: deployment.commitSha ?? undefined,
    signal
  });
  if (cloneResult.exitCode !== 0) {
    await markStepFailed(cloneStepId, `git clone exited with code ${cloneResult.exitCode}`);
    throw new Error(`git clone failed with exit code ${cloneResult.exitCode}`);
  }
  let workDir = cloneResult.workDir;
  if (target.mode === "remote") {
    const localArchivePath = getStagingArchivePath(deployment.id);
    const remoteArchivePath = `${target.remoteWorkDir}/${deployment.id}.tar.gz`;
    const archiveResult = await createTarArchive(
      cloneResult.workDir,
      localArchivePath,
      onLog,
      signal
    );
    if (archiveResult.exitCode !== 0) {
      await markStepFailed(cloneStepId, `tar archive exited with code ${archiveResult.exitCode}`);
      throw new Error(`tar archive creation failed with exit code ${archiveResult.exitCode}`);
    }
    const ensureDirResult = await remoteEnsureDir(target.ssh, target.remoteWorkDir, onLog, signal);
    if (ensureDirResult.exitCode !== 0) {
      await markStepFailed(cloneStepId, "Remote workspace preparation failed");
      throw new Error(`Failed to prepare remote workspace ${target.remoteWorkDir}.`);
    }
    const uploadArchive = await scpUpload(
      target.ssh,
      localArchivePath,
      remoteArchivePath,
      onLog,
      signal
    );
    if (uploadArchive.exitCode !== 0) {
      await markStepFailed(cloneStepId, "Repository archive upload failed");
      throw new Error(`Failed to upload repository archive for deployment ${deployment.id}.`);
    }
    const extractRemote = await remoteExtractArchive(
      target.ssh,
      remoteArchivePath,
      target.remoteWorkDir,
      onLog,
      signal
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

  const absoluteContext = `${workDir}/${buildContext}`.replace("//", "/");
  const absoluteDockerfile = `${workDir}/${dockerfile}`.replace("//", "/");

  const buildResult = await withDeploymentBuildLease({
    deploymentId: deployment.id,
    serverId: deployment.targetServerId,
    onLog,
    signal,
    run: (signal) =>
      target.mode === "remote"
        ? remoteDockerBuild(
            target.ssh,
            absoluteContext,
            absoluteDockerfile,
            tag,
            buildDockerOwnershipLabels(ownership),
            onLog,
            registryCredentials,
            signal
          )
        : dockerBuild(
            absoluteContext,
            absoluteDockerfile,
            tag,
            buildDockerOwnershipLabels(ownership),
            onLog,
            registryCredentials,
            signal
          )
  });
  if (buildResult.exitCode !== 0) {
    await markStepFailed(buildStepId, `docker build exited with code ${buildResult.exitCode}`);
    throw new Error(`docker build failed with exit code ${buildResult.exitCode}`);
  }
  await markStepComplete(buildStepId, `Image ${tag} built successfully`);
  await throwIfDeploymentCancellationRequested(deployment.id);

  // Step 3: Run container
  const runStepId = await createStep(deployment.id, "Start container", 3);
  await markStepRunning(runStepId);

  const runResult = await runOwnedDockerContainer({
    tag,
    containerName,
    config,
    ownership,
    onLog,
    target,
    signal
  });
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
  await waitForDirectDeploymentHealth(deployment, containerName, onLog, target, signal);
}

export async function executeImageDeployment(
  deployment: DeploymentRow,
  config: ConfigSnapshot,
  containerName: string,
  ownership: DockerOwnershipIdentity,
  onLog: OnLog,
  target: ExecutionTarget,
  signal?: AbortSignal
): Promise<void> {
  const sourceTag = deployment.imageTag ?? "";
  if (!sourceTag) {
    throw new Error("Image deployment requires an imageTag");
  }
  const tag = buildOwnedImageTag(deployment.id);

  await throwIfDeploymentCancellationRequested(deployment.id);
  const registryCredentials = await listContainerRegistryCredentialsForProjectImageReferences(
    deployment.projectId,
    [sourceTag]
  );

  // Step 1: Pull image
  const pullStepId = await createStep(deployment.id, "Pull image", 1);
  await markStepRunning(pullStepId);

  const pullResult =
    target.mode === "remote"
      ? await remoteDockerPull(target.ssh, sourceTag, onLog, registryCredentials, signal)
      : await dockerPull(sourceTag, onLog, registryCredentials, signal);
  if (pullResult.exitCode !== 0) {
    await markStepFailed(pullStepId, `docker pull exited with code ${pullResult.exitCode}`);
    throw new Error(`docker pull failed with exit code ${pullResult.exitCode}`);
  }
  const ownershipWrapperResult =
    target.mode === "remote"
      ? await remoteDockerBuildMetadataWrapper(
          target.ssh,
          sourceTag,
          tag,
          buildDockerOwnershipLabels(ownership),
          onLog,
          signal
        )
      : await dockerBuildMetadataWrapper(
          sourceTag,
          tag,
          buildDockerOwnershipLabels(ownership),
          onLog,
          signal
        );
  if (ownershipWrapperResult.exitCode !== 0) {
    await markStepFailed(
      pullStepId,
      `Docker ownership metadata wrapper exited with code ${ownershipWrapperResult.exitCode}`
    );
    throw new Error(
      `Docker ownership metadata wrapper failed with exit code ${ownershipWrapperResult.exitCode}`
    );
  }
  await markStepComplete(pullStepId, `Image ${sourceTag} pulled and wrapped as ${tag}`);
  await throwIfDeploymentCancellationRequested(deployment.id);

  // Step 2: Start container
  await transitionDeployment(deployment.id, "deploy");
  const runStepId = await createStep(deployment.id, "Start container", 2);
  await markStepRunning(runStepId);

  const runResult = await runOwnedDockerContainer({
    tag,
    containerName,
    config,
    ownership,
    onLog,
    target,
    signal
  });
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
  await waitForDirectDeploymentHealth(deployment, containerName, onLog, target, signal);
}
