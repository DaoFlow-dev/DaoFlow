import { throwIfDeploymentCancellationRequested } from "../db/services/deployment-execution-control";
import { checkContainerHealth, type OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import { remoteCheckContainerHealth } from "./ssh-executor";
import {
  createStep,
  markStepComplete,
  markStepFailed,
  markStepRunning,
  type DeploymentRow
} from "./step-management";

const HEALTH_CHECK_TIMEOUT_MS = 60_000;
const HEALTH_CHECK_INTERVAL_MS = 3_000;

export async function waitForDirectDeploymentHealth(
  deployment: DeploymentRow,
  containerName: string,
  onLog: OnLog,
  target: ExecutionTarget,
  signal?: AbortSignal
): Promise<void> {
  const healthStepId = await createStep(deployment.id, "Health check", 10);
  await markStepRunning(healthStepId);

  const start = Date.now();
  while (Date.now() - start < HEALTH_CHECK_TIMEOUT_MS) {
    signal?.throwIfAborted();
    await throwIfDeploymentCancellationRequested(deployment.id);
    const healthy =
      target.mode === "remote"
        ? await remoteCheckContainerHealth(target.ssh, containerName, onLog, signal)
        : await checkContainerHealth(containerName, onLog, signal);
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
