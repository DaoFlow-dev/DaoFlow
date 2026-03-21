import type { ComposeReadinessProbeSnapshot } from "../compose-readiness";
import { assessComposeHealth, type ComposeContainerStatus } from "./compose-health";
import {
  runLocalComposeReadinessCheck,
  runRemoteComposeReadinessCheck
} from "./compose-readiness-check";
import { dockerComposePs, type OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import { remoteDockerComposePs } from "./ssh-executor";
import { markStepComplete, markStepFailed } from "./step-management";
import { throwIfDeploymentCancellationRequested } from "../db/services/deployment-execution-control";

const HEALTH_CHECK_TIMEOUT_MS = 60_000;
const HEALTH_CHECK_INTERVAL_MS = 3_000;

async function readComposeHealthStatuses(
  composeFile: string,
  projectName: string,
  workDir: string,
  onLog: OnLog,
  target: ExecutionTarget,
  envFile?: string,
  envExportFile?: string,
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
        envExportFile,
        composeServiceName
      )
    : dockerComposePs(composeFile, projectName, workDir, onLog, envFile, composeServiceName);
}

export async function waitForComposeHealthy(input: {
  deploymentId: string;
  composeFile: string;
  projectName: string;
  workDir: string;
  composeTargetLabel: string;
  composeServiceName?: string;
  composeEnvFile?: string;
  composeEnvExportFile?: string;
  onLog: OnLog;
  target: ExecutionTarget;
  healthStepId: number;
  readinessProbe: ComposeReadinessProbeSnapshot | null;
  expectedServiceNames?: string[];
  expectedHealthcheckServiceNames?: string[];
}): Promise<void> {
  const composeStart = Date.now();
  let readinessStart: number | null = null;
  let lastPendingSummary = `${input.composeTargetLabel} are still converging`;
  const composePsScopeServiceName =
    input.expectedServiceNames && input.expectedServiceNames.length > 1
      ? undefined
      : input.composeServiceName;

  const intervalMs = input.readinessProbe
    ? input.readinessProbe.intervalSeconds * 1_000
    : HEALTH_CHECK_INTERVAL_MS;

  while (true) {
    await throwIfDeploymentCancellationRequested(input.deploymentId);
    const now = Date.now();
    if (!readinessStart && now - composeStart >= HEALTH_CHECK_TIMEOUT_MS) {
      await markStepFailed(
        input.healthStepId,
        `Timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s: ${lastPendingSummary}`
      );
      throw new Error(`Health check timeout for ${input.composeTargetLabel}`);
    }

    if (
      input.readinessProbe &&
      readinessStart !== null &&
      now - readinessStart >= input.readinessProbe.timeoutSeconds * 1_000
    ) {
      await markStepFailed(
        input.healthStepId,
        `Timed out after ${input.readinessProbe.timeoutSeconds}s: ${lastPendingSummary}`
      );
      throw new Error(`Health check timeout for ${input.composeTargetLabel}`);
    }

    const statusResult = await readComposeHealthStatuses(
      input.composeFile,
      input.projectName,
      input.workDir,
      input.onLog,
      input.target,
      input.composeEnvFile,
      input.composeEnvExportFile,
      composePsScopeServiceName
    );
    if (statusResult.exitCode !== 0) {
      await markStepFailed(
        input.healthStepId,
        `docker compose ps exited with code ${statusResult.exitCode}`
      );
      throw new Error(`docker compose ps failed with exit code ${statusResult.exitCode}`);
    }

    const assessment = assessComposeHealth(
      statusResult.statuses,
      input.composeTargetLabel,
      input.expectedServiceNames,
      input.expectedHealthcheckServiceNames
    );
    if (assessment.kind === "healthy") {
      if (!input.readinessProbe) {
        await markStepComplete(input.healthStepId, assessment.summary);
        return;
      }

      readinessStart ??= Date.now();
      const readinessAttempt =
        input.target.mode === "remote"
          ? await runRemoteComposeReadinessCheck(
              input.target.ssh,
              input.readinessProbe,
              statusResult.statuses,
              input.onLog
            )
          : await runLocalComposeReadinessCheck(input.readinessProbe, statusResult.statuses);

      if (readinessAttempt.kind === "success") {
        await markStepComplete(
          input.healthStepId,
          `${assessment.summary}; ${readinessAttempt.summary}`
        );
        return;
      }

      if (readinessAttempt.kind === "failed") {
        await markStepFailed(input.healthStepId, readinessAttempt.summary);
        throw new Error(readinessAttempt.summary);
      }

      lastPendingSummary = readinessAttempt.summary;
      await new Promise((resolve) => setTimeout(resolve, intervalMs));
      continue;
    }

    if (assessment.kind === "failed") {
      await markStepFailed(input.healthStepId, assessment.summary);
      throw new Error(assessment.summary);
    }

    lastPendingSummary = assessment.summary;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  }
}
