import type { ComposeReadinessProbeSnapshot } from "../compose-readiness";
import { assessComposeHealth } from "./compose-health";
import {
  runComposeHealthReadinessCheck,
  runSwarmHealthReadinessCheck
} from "./compose-deploy-health-readiness";
import { readComposeHealthStatuses, readSwarmHealthStatuses } from "./compose-deploy-health-status";
import { type OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import { markStepComplete, markStepFailed } from "./step-management";
import { throwIfDeploymentCancellationRequested } from "../db/services/deployment-execution-control";
import { assessSwarmStackHealth } from "./swarm-health";

const HEALTH_CHECK_TIMEOUT_MS = 60_000;
const HEALTH_CHECK_INTERVAL_MS = 3_000;

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
      const readinessAttempt = await runComposeHealthReadinessCheck({
        readinessProbe: input.readinessProbe,
        statuses: statusResult.statuses,
        onLog: input.onLog,
        target: input.target
      });

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

export async function waitForSwarmStackHealthy(input: {
  deploymentId: string;
  stackName: string;
  workDir: string;
  stackTargetLabel: string;
  onLog: OnLog;
  target: ExecutionTarget;
  healthStepId: number;
  readinessProbe: ComposeReadinessProbeSnapshot | null;
}): Promise<void> {
  const swarmStart = Date.now();
  let readinessStart: number | null = null;
  let lastPendingSummary = `${input.stackTargetLabel} is still converging`;
  const intervalMs = input.readinessProbe
    ? input.readinessProbe.intervalSeconds * 1_000
    : HEALTH_CHECK_INTERVAL_MS;

  while (true) {
    await throwIfDeploymentCancellationRequested(input.deploymentId);
    const now = Date.now();
    if (!readinessStart && now - swarmStart >= HEALTH_CHECK_TIMEOUT_MS) {
      await markStepFailed(
        input.healthStepId,
        `Timed out after ${HEALTH_CHECK_TIMEOUT_MS / 1000}s: ${lastPendingSummary}`
      );
      throw new Error(`Health check timeout for ${input.stackTargetLabel}`);
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
      throw new Error(`Health check timeout for ${input.stackTargetLabel}`);
    }

    const { serviceResult, taskResult } = await readSwarmHealthStatuses(
      input.stackName,
      input.workDir,
      input.onLog,
      input.target
    );

    if (serviceResult.exitCode !== 0) {
      await markStepFailed(
        input.healthStepId,
        `docker stack services exited with code ${serviceResult.exitCode}`
      );
      throw new Error(`docker stack services failed with exit code ${serviceResult.exitCode}`);
    }

    if (taskResult.exitCode !== 0) {
      await markStepFailed(
        input.healthStepId,
        `docker stack ps exited with code ${taskResult.exitCode}`
      );
      throw new Error(`docker stack ps failed with exit code ${taskResult.exitCode}`);
    }

    const assessment = assessSwarmStackHealth(
      serviceResult.services,
      taskResult.tasks,
      input.stackTargetLabel
    );
    if (assessment.kind === "healthy") {
      if (!input.readinessProbe) {
        await markStepComplete(input.healthStepId, assessment.summary);
        return;
      }

      const readinessProbe = input.readinessProbe;
      readinessStart ??= Date.now();
      const readinessAttempt = await runSwarmHealthReadinessCheck({
        stackName: input.stackName,
        workDir: input.workDir,
        readinessProbe,
        tasks: taskResult.tasks,
        onLog: input.onLog,
        target: input.target
      });

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
