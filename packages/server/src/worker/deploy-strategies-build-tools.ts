import { eq } from "drizzle-orm";
import { buildDockerOwnershipLabels, type DockerOwnershipIdentity } from "../docker-ownership";
import { db } from "../db/connection";
import { deployments } from "../db/schema/deployments";
import { throwIfDeploymentCancellationRequested } from "../db/services/deployment-execution-control";
import { resolveCheckoutSpec } from "./checkout-source";
import { withDeploymentBuildLease } from "./deployment-build-lease";
import { waitForDirectDeploymentHealth } from "./direct-deployment-health";
import { runOwnedDockerContainer } from "./direct-docker-run";
import {
  dockerBuildMetadataWrapper,
  execStreaming,
  gitClone,
  STAGING_DIR,
  type OnLog
} from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import {
  createStep,
  markStepComplete,
  markStepFailed,
  markStepRunning,
  type ConfigSnapshot,
  type DeploymentRow
} from "./step-management";

async function cloneBuildSource(input: {
  deployment: DeploymentRow;
  config: ConfigSnapshot;
  label: "Nixpacks" | "buildpack";
  onLog: OnLog;
  signal?: AbortSignal;
}) {
  const cloneStepId = await createStep(input.deployment.id, "Clone repository", 1);
  await markStepRunning(cloneStepId);
  const checkout = await resolveCheckoutSpec(input.config);
  if (!checkout) {
    await markStepFailed(cloneStepId, `No repository URL provided for ${input.label} deployment`);
    throw new Error(`${input.label} deployment requires a repository URL`);
  }
  const result = await gitClone(
    checkout.repoUrl,
    checkout.branch,
    input.deployment.id,
    input.onLog,
    {
      displayLabel: checkout.displayLabel,
      gitConfig: checkout.gitConfig,
      caCertificatePem: checkout.caCertificatePem,
      sshPrivateKey: checkout.sshPrivateKey,
      repositoryPreparation: checkout.repositoryPreparation,
      commitSha: input.deployment.commitSha ?? undefined,
      signal: input.signal
    }
  );
  if (result.exitCode !== 0) {
    await markStepFailed(cloneStepId, `git clone exited with code ${result.exitCode}`);
    throw new Error(`git clone failed with exit code ${result.exitCode}`);
  }
  await markStepComplete(cloneStepId, `Repository cloned to ${result.workDir}`);
  await throwIfDeploymentCancellationRequested(input.deployment.id);
  return result.workDir;
}

async function startBuiltContainer(input: {
  deployment: DeploymentRow;
  config: ConfigSnapshot;
  containerName: string;
  ownership: DockerOwnershipIdentity;
  tag: string;
  onLog: OnLog;
  target: ExecutionTarget;
  signal?: AbortSignal;
}) {
  const runStepId = await createStep(input.deployment.id, "Start container", 3);
  await markStepRunning(runStepId);
  const runResult = await runOwnedDockerContainer({
    tag: input.tag,
    containerName: input.containerName,
    config: input.config,
    ownership: input.ownership,
    onLog: input.onLog,
    target: input.target,
    signal: input.signal
  });
  if (runResult.exitCode !== 0) {
    await markStepFailed(runStepId, `docker run exited with code ${runResult.exitCode}`);
    throw new Error(`docker run failed with exit code ${runResult.exitCode}`);
  }
  await db
    .update(deployments)
    .set({ containerId: input.containerName })
    .where(eq(deployments.id, input.deployment.id));
  await markStepComplete(runStepId, `Container ${input.containerName} started`);
  await throwIfDeploymentCancellationRequested(input.deployment.id);
  await waitForDirectDeploymentHealth(
    input.deployment,
    input.containerName,
    input.onLog,
    input.target,
    input.signal
  );
}

export async function executeNixpacksDeployment(
  deployment: DeploymentRow,
  config: ConfigSnapshot,
  containerName: string,
  ownership: DockerOwnershipIdentity,
  onLog: OnLog,
  target: ExecutionTarget,
  signal?: AbortSignal
): Promise<void> {
  const tag = `daoflow/${deployment.serviceName}:${deployment.commitSha ?? "latest"}`;
  await throwIfDeploymentCancellationRequested(deployment.id);
  const workDir = await cloneBuildSource({
    deployment,
    config,
    label: "Nixpacks",
    onLog,
    signal
  });
  const buildStepId = await createStep(deployment.id, "Nixpacks build", 2);
  await markStepRunning(buildStepId);
  const args = ["build", workDir, "--name", tag];
  const env = config.env ?? {};
  for (const [key, value] of Object.entries(buildDockerOwnershipLabels(ownership))) {
    args.push("--label", `${key}=${value}`);
  }
  for (const [key, value] of Object.entries(env)) args.push("--env", `${key}=${value}`);
  const result = await withDeploymentBuildLease({
    deploymentId: deployment.id,
    serverId: deployment.targetServerId,
    onLog,
    signal,
    run: (leaseSignal) =>
      execStreaming("nixpacks", args, STAGING_DIR, onLog, undefined, { signal: leaseSignal })
  });
  if (result.exitCode !== 0) {
    await markStepFailed(buildStepId, `nixpacks build exited with code ${result.exitCode}`);
    throw new Error(`nixpacks build failed with exit code ${result.exitCode}`);
  }
  await markStepComplete(buildStepId, `Image ${tag} built with Nixpacks`);
  await throwIfDeploymentCancellationRequested(deployment.id);
  await startBuiltContainer({
    deployment,
    config: { ...config, env },
    containerName,
    ownership,
    tag,
    onLog,
    target,
    signal
  });
}

export async function executeBuildpackDeployment(
  deployment: DeploymentRow,
  config: ConfigSnapshot,
  containerName: string,
  ownership: DockerOwnershipIdentity,
  onLog: OnLog,
  target: ExecutionTarget,
  signal?: AbortSignal
): Promise<void> {
  const tag = `daoflow/${deployment.serviceName}:${deployment.commitSha ?? "latest"}`;
  const builder = config.buildpackBuilder ?? "heroku/builder:24";
  await throwIfDeploymentCancellationRequested(deployment.id);
  const workDir = await cloneBuildSource({
    deployment,
    config,
    label: "buildpack",
    onLog,
    signal
  });
  const buildStepId = await createStep(deployment.id, "Buildpack build", 2);
  await markStepRunning(buildStepId);
  const args = ["build", tag, "--builder", builder, "--path", workDir];
  const env = config.env ?? {};
  for (const [key, value] of Object.entries(env)) args.push("--env", `${key}=${value}`);
  const result = await withDeploymentBuildLease({
    deploymentId: deployment.id,
    serverId: deployment.targetServerId,
    onLog,
    signal,
    run: (leaseSignal) =>
      execStreaming("pack", args, STAGING_DIR, onLog, undefined, { signal: leaseSignal })
  });
  if (result.exitCode !== 0) {
    await markStepFailed(buildStepId, `pack build exited with code ${result.exitCode}`);
    throw new Error(`pack build failed with exit code ${result.exitCode}`);
  }
  const wrapper = await withDeploymentBuildLease({
    deploymentId: deployment.id,
    serverId: deployment.targetServerId,
    onLog,
    signal,
    run: (leaseSignal) =>
      dockerBuildMetadataWrapper(
        tag,
        tag,
        buildDockerOwnershipLabels(ownership),
        onLog,
        leaseSignal
      )
  });
  if (wrapper.exitCode !== 0) {
    await markStepFailed(
      buildStepId,
      `Docker ownership metadata wrapper exited with code ${wrapper.exitCode}`
    );
    throw new Error(`Docker ownership metadata wrapper failed with exit code ${wrapper.exitCode}`);
  }
  await markStepComplete(buildStepId, `Image ${tag} built with ${builder}`);
  await throwIfDeploymentCancellationRequested(deployment.id);
  await startBuiltContainer({
    deployment,
    config: { ...config, env },
    containerName,
    ownership,
    tag,
    onLog,
    target,
    signal
  });
}
