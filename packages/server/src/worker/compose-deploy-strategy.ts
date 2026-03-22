import { COMPOSE_ENV_EXPORT_FILE_NAME, COMPOSE_ENV_FILE_NAME } from "../compose-env";
import type { ComposeBuildPlan } from "../compose-build-plan";
import { resolveComposeExecutionScope } from "../compose-build-plan-execution";
import { readComposeReadinessProbeSnapshot } from "../compose-readiness";
import {
  listAllContainerRegistryCredentials,
  listContainerRegistryCredentialsByImageReferences
} from "../db/services/container-registries";
import {
  persistDeploymentComposeEnvState,
  readDeploymentComposeState
} from "../db/services/compose-env";
import { prepareComposeWorkspace } from "./compose-workspace";
import { waitForComposeHealthy, waitForSwarmStackHealthy } from "./compose-deploy-health";
import {
  runComposeBuildOperation,
  runComposePullOperation,
  runComposeStartOperation,
  runComposeStopOperation
} from "./compose-deploy-operations";
import { type OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import {
  createStep,
  markStepComplete,
  markStepFailed,
  markStepRunning,
  transitionDeployment,
  type ConfigSnapshot,
  type DeploymentRow
} from "./step-management";
import { throwIfDeploymentCancellationRequested } from "../db/services/deployment-execution-control";

function isSwarmManagerTarget(target: ExecutionTarget): boolean {
  return target.serverKind === "docker-swarm-manager";
}

function collectComposeImageReferences(
  composeBuildPlan: ComposeBuildPlan,
  config: ConfigSnapshot
): string[] {
  return [
    ...composeBuildPlan.services.map((service) => service.image),
    ...composeBuildPlan.graphServices.map((service) => service.image),
    config.composeImageOverride?.imageReference
  ].filter((imageReference): imageReference is string => Boolean(imageReference?.trim()));
}

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
  const swarmTargetLabel = `swarm stack ${projectName}`;
  const readinessProbe = readComposeReadinessProbeSnapshot(config.readinessProbe);
  const composeOperation = config.composeOperation === "down" ? "down" : "up";
  const swarmManagerTarget = isSwarmManagerTarget(target);

  const cloneStepId = await createStep(
    deployment.id,
    uploadedSource ? "Prepare uploaded workspace" : "Clone repository",
    1
  );
  await markStepRunning(cloneStepId);

  let workDir: string;
  let composeFile: string;
  let composeEnvFile: string | undefined;
  let composeEnvExportFile: string | undefined;
  let composeBuildPlan: ComposeBuildPlan;
  const deploymentComposeState = readDeploymentComposeState(deployment.envVarsEncrypted);
  await throwIfDeploymentCancellationRequested(deployment.id);
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
    composeBuildPlan = workspace.composeBuildPlan;
    composeEnvFile = COMPOSE_ENV_FILE_NAME;
    composeEnvExportFile = COMPOSE_ENV_EXPORT_FILE_NAME;
    await persistDeploymentComposeEnvState({
      deploymentId: deployment.id,
      envEntries: workspace.composeEnv.payloadEntries,
      composeEnv: workspace.composeEnv.composeEnv,
      composeBuildPlan: workspace.composeBuildPlan,
      composeInputs: workspace.composeInputs.manifest,
      frozenInputs: workspace.composeInputs.frozenInputs
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    await markStepFailed(cloneStepId, message);
    throw error;
  }
  await markStepComplete(cloneStepId, `Workspace ready at ${workDir}`);
  await throwIfDeploymentCancellationRequested(deployment.id);

  const composeImageReferences = collectComposeImageReferences(composeBuildPlan, config);
  const pullRegistryCredentials =
    await listContainerRegistryCredentialsByImageReferences(composeImageReferences);
  const buildRegistryCredentials = await listAllContainerRegistryCredentials();

  if (composeOperation === "down") {
    await transitionDeployment(deployment.id, "deploy");
    const stopStepId = await createStep(
      deployment.id,
      swarmManagerTarget ? "Remove preview stack" : "Stop preview stack",
      2
    );
    await markStepRunning(stopStepId);

    const downResult = await runComposeStopOperation({
      swarmManagerTarget,
      target,
      projectName,
      workDir,
      composeFile,
      onLog,
      composeEnvFile,
      composeEnvExportFile
    });
    if (downResult.exitCode !== 0) {
      await markStepFailed(
        stopStepId,
        swarmManagerTarget
          ? `docker stack rm exited with code ${downResult.exitCode}`
          : `docker compose down exited with code ${downResult.exitCode}`
      );
      throw new Error(
        swarmManagerTarget
          ? `docker stack rm failed with exit code ${downResult.exitCode}`
          : `docker compose down failed with exit code ${downResult.exitCode}`
      );
    }

    await markStepComplete(
      stopStepId,
      swarmManagerTarget
        ? `Removed swarm stack ${projectName}`
        : `Stopped compose project ${projectName}`
    );
    return;
  }

  const executionScope = resolveComposeExecutionScope(composeBuildPlan, composeServiceName);
  let nextSortOrder = 2;

  if (executionScope.needsPull) {
    const pullStepId = await createStep(
      deployment.id,
      composeServiceName ? `Pull images for ${composeServiceName}` : "Pull images",
      nextSortOrder
    );
    nextSortOrder += 1;
    await markStepRunning(pullStepId);

    const pullResult = await runComposePullOperation({
      target,
      composeFile,
      projectName,
      workDir,
      onLog,
      composeEnvFile,
      composeEnvExportFile,
      composeServiceName,
      registryCredentials: pullRegistryCredentials
    });
    if (pullResult.exitCode !== 0) {
      await markStepFailed(
        pullStepId,
        `docker compose pull exited with code ${pullResult.exitCode}`
      );
      throw new Error(`docker compose pull failed with exit code ${pullResult.exitCode}`);
    }
    await markStepComplete(pullStepId, `Pulled images for ${composeTargetLabel}`);
    await throwIfDeploymentCancellationRequested(deployment.id);
  }

  if (executionScope.buildServiceNames.length > 0) {
    const buildStepId = await createStep(
      deployment.id,
      composeServiceName ? `Build ${composeServiceName}` : "Build images",
      nextSortOrder
    );
    nextSortOrder += 1;
    await markStepRunning(buildStepId);

    const buildResult = await runComposeBuildOperation({
      target,
      composeFile,
      projectName,
      workDir,
      onLog,
      composeEnvFile,
      composeEnvExportFile,
      executionScope,
      registryCredentials: buildRegistryCredentials
    });
    if (buildResult.exitCode !== 0) {
      await markStepFailed(
        buildStepId,
        `docker compose build exited with code ${buildResult.exitCode}`
      );
      throw new Error(`docker compose build failed with exit code ${buildResult.exitCode}`);
    }
    await markStepComplete(buildStepId, `Built images for ${composeTargetLabel}`);
    await throwIfDeploymentCancellationRequested(deployment.id);
  }

  await transitionDeployment(deployment.id, "deploy");
  const deployStepId = await createStep(
    deployment.id,
    swarmManagerTarget
      ? "Deploy swarm stack"
      : composeServiceName
        ? `Start ${composeServiceName}`
        : "Start services",
    nextSortOrder
  );
  nextSortOrder += 1;
  await markStepRunning(deployStepId);

  const upResult = await runComposeStartOperation({
    swarmManagerTarget,
    target,
    composeFile,
    projectName,
    workDir,
    onLog,
    composeEnvFile,
    composeEnvExportFile,
    composeServiceName,
    registryCredentials: pullRegistryCredentials
  });
  if (upResult.exitCode !== 0) {
    await markStepFailed(
      deployStepId,
      swarmManagerTarget
        ? `docker stack deploy exited with code ${upResult.exitCode}`
        : `docker compose up exited with code ${upResult.exitCode}`
    );
    throw new Error(
      swarmManagerTarget
        ? `docker stack deploy failed with exit code ${upResult.exitCode}`
        : `docker compose up failed with exit code ${upResult.exitCode}`
    );
  }
  await markStepComplete(
    deployStepId,
    swarmManagerTarget ? `Deployed ${swarmTargetLabel}` : `Started ${composeTargetLabel}`
  );
  await throwIfDeploymentCancellationRequested(deployment.id);

  const healthStepId = await createStep(deployment.id, "Health check", nextSortOrder);
  await markStepRunning(healthStepId);
  if (swarmManagerTarget) {
    await waitForSwarmStackHealthy({
      deploymentId: deployment.id,
      stackName: projectName,
      workDir,
      stackTargetLabel: swarmTargetLabel,
      onLog,
      target,
      healthStepId,
      readinessProbe
    });
    return;
  }

  await waitForComposeHealthy({
    composeFile,
    projectName,
    workDir,
    composeTargetLabel,
    composeServiceName,
    composeEnvFile,
    composeEnvExportFile,
    onLog,
    target,
    healthStepId,
    readinessProbe,
    expectedServiceNames: executionScope.expectedServiceNames,
    expectedHealthcheckServiceNames: executionScope.buildHealthcheckServiceNames,
    deploymentId: deployment.id
  });
}
