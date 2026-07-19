import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { environments, projects } from "../db/schema/projects";
import { services } from "../db/schema/services";
import { cleanupStagingDir } from "./docker-executor";
import { resolveExecutionTarget, withPreparedExecutionTarget } from "./execution-target";
import { createLogStreamer } from "./log-streamer";
import {
  transitionDeployment,
  emitEvent,
  readConfig,
  touchDeploymentProgress,
  type DeploymentRow
} from "./step-management";
import {
  executeBuildpackDeployment,
  executeComposeDeployment,
  executeDockerfileDeployment,
  executeImageDeployment,
  executeNixpacksDeployment
} from "./deploy-strategies";
import { throwIfDeploymentCancellationRequested } from "../db/services/deployment-execution-control";
import { DeploymentCancellationError } from "../deployment-cancellation";
import { buildDockerContainerName } from "../docker-identifiers";
import { getServerForTeam } from "../db/services/team-scoped-servers";
import { DeploymentLifecycleStatus } from "@daoflow/shared";
import { assertDockerOwnershipIdentity, type DockerOwnershipIdentity } from "../docker-ownership";

const DEFAULT_DEPLOY_TIMEOUT_MS = 24 * 60 * 60_000;
const DEPLOY_TIMEOUT_MS = (() => {
  const parsed = Number(process.env.DEPLOY_TIMEOUT_MS ?? DEFAULT_DEPLOY_TIMEOUT_MS);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : DEFAULT_DEPLOY_TIMEOUT_MS;
})();
const DEPLOYMENT_PROGRESS_HEARTBEAT_MS = 30_000;

class DeploymentTimeoutError extends Error {
  constructor(timeoutMs: number) {
    super(`Deployment timed out after ${timeoutMs / 1000}s`);
    this.name = "DeploymentTimeoutError";
  }
}

function throwIfExecutionAborted(signal?: AbortSignal): void {
  signal?.throwIfAborted();
}

async function resolveDeploymentOwnership(
  deployment: DeploymentRow
): Promise<DockerOwnershipIdentity> {
  const matches = await db
    .select({
      teamId: projects.teamId,
      projectId: projects.id,
      environmentId: environments.id,
      serviceId: services.id
    })
    .from(projects)
    .innerJoin(
      environments,
      and(eq(environments.id, deployment.environmentId), eq(environments.projectId, projects.id))
    )
    .innerJoin(
      services,
      and(
        eq(services.id, deployment.serviceId),
        eq(services.projectId, projects.id),
        eq(services.environmentId, environments.id)
      )
    )
    .where(eq(projects.id, deployment.projectId))
    .limit(2);

  if (matches.length !== 1) {
    throw new Error(
      `Deployment ${deployment.id} does not resolve to exactly one matching project, environment, and service.`
    );
  }

  const match = matches[0];
  return assertDockerOwnershipIdentity({
    teamId: match.teamId,
    projectId: match.projectId,
    environmentId: match.environmentId,
    serviceId: match.serviceId,
    deploymentId: deployment.id
  });
}

export async function runDeployment(
  deployment: DeploymentRow,
  actorLabel = "execution-worker",
  signal?: AbortSignal,
  timeoutMs = DEPLOY_TIMEOUT_MS
): Promise<"succeeded" | "cancelled"> {
  const config = readConfig(deployment);
  const { onLog, flush } = createLogStreamer(deployment.id, actorLabel);

  const projectName = config.projectName ?? deployment.serviceName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const composeProjectName = config.stackName ?? projectName;
  const containerName = buildDockerContainerName(projectName, deployment.serviceName);
  const ownership = await resolveDeploymentOwnership(deployment);
  const server = await getServerForTeam(deployment.targetServerId, ownership.teamId);

  if (!server) {
    throw new Error(`Target server ${deployment.targetServerId} not found`);
  }

  const target = await resolveExecutionTarget(server, deployment.id, ownership.teamId);
  const executionController = new AbortController();
  const abortFromCaller = () => executionController.abort(signal?.reason);
  if (signal?.aborted) {
    abortFromCaller();
  } else {
    signal?.addEventListener("abort", abortFromCaller, { once: true });
  }
  const timeoutError = new DeploymentTimeoutError(timeoutMs);
  const executionTimeout = setTimeout(() => executionController.abort(timeoutError), timeoutMs);
  const executionSignal = executionController.signal;
  const progressHeartbeat = setInterval(() => {
    void touchDeploymentProgress(deployment.id).catch((error) => {
      console.warn(
        `[deployment-heartbeat] Unable to update deployment ${deployment.id}:`,
        error instanceof Error ? error.message : String(error)
      );
    });
  }, DEPLOYMENT_PROGRESS_HEARTBEAT_MS);

  try {
    throwIfExecutionAborted(executionSignal);
    await throwIfDeploymentCancellationRequested(deployment.id);
    if (deployment.status !== DeploymentLifecycleStatus.Waiting) {
      await transitionDeployment(deployment.id, DeploymentLifecycleStatus.Prepare);
    }
    await emitEvent(
      "deployment.prepare.started",
      deployment,
      "Deployment preparation started",
      `${actorLabel} began preparing ${deployment.serviceName}`
    );

    await withPreparedExecutionTarget(target, async (preparedTarget) => {
      throwIfExecutionAborted(executionSignal);
      await throwIfDeploymentCancellationRequested(deployment.id);
      if (deployment.sourceType === "compose") {
        await executeComposeDeployment(
          deployment,
          config,
          composeProjectName,
          ownership,
          onLog,
          preparedTarget,
          executionSignal
        );
        throwIfExecutionAborted(executionSignal);
        await throwIfDeploymentCancellationRequested(deployment.id);
        return;
      }

      if (deployment.sourceType === "dockerfile") {
        await executeDockerfileDeployment(
          deployment,
          config,
          containerName,
          ownership,
          onLog,
          preparedTarget,
          executionSignal
        );
        throwIfExecutionAborted(executionSignal);
        await throwIfDeploymentCancellationRequested(deployment.id);
        return;
      }

      if (deployment.sourceType === "image") {
        await executeImageDeployment(
          deployment,
          config,
          containerName,
          ownership,
          onLog,
          preparedTarget,
          executionSignal
        );
        throwIfExecutionAborted(executionSignal);
        await throwIfDeploymentCancellationRequested(deployment.id);
        return;
      }

      if (deployment.sourceType === "nixpacks") {
        await executeNixpacksDeployment(
          deployment,
          config,
          containerName,
          ownership,
          onLog,
          preparedTarget,
          executionSignal
        );
        throwIfExecutionAborted(executionSignal);
        await throwIfDeploymentCancellationRequested(deployment.id);
        return;
      }

      if (deployment.sourceType === "buildpack") {
        await executeBuildpackDeployment(
          deployment,
          config,
          containerName,
          ownership,
          onLog,
          preparedTarget,
          executionSignal
        );
        throwIfExecutionAborted(executionSignal);
        await throwIfDeploymentCancellationRequested(deployment.id);
        return;
      }

      throw new Error(`Unsupported source type: ${deployment.sourceType}`);
    });

    await transitionDeployment(deployment.id, "completed", "succeeded");
    await emitEvent(
      "deployment.succeeded",
      deployment,
      "Deployment completed successfully",
      `${deployment.serviceName} is now running`
    );
    return "succeeded";
  } catch (error) {
    if (error instanceof DeploymentCancellationError || signal?.aborted) {
      const message =
        error instanceof DeploymentCancellationError
          ? error.message
          : signal?.reason instanceof Error
            ? signal.reason.message
            : "Deployment execution was cancelled by the workflow engine.";
      await transitionDeployment(deployment.id, "failed", "cancelled", message);
      await emitEvent(
        "deployment.cancelled",
        deployment,
        "Deployment cancelled",
        message,
        "warning"
      );
      return "cancelled";
    }

    if (executionSignal.aborted && executionSignal.reason === timeoutError) {
      await transitionDeployment(deployment.id, "failed", "failed", timeoutError);
      await emitEvent(
        "deployment.failed",
        deployment,
        "Deployment failed",
        timeoutError.message,
        "error"
      );
      throw timeoutError;
    }

    await transitionDeployment(deployment.id, "failed", "failed", error);
    await emitEvent(
      "deployment.failed",
      deployment,
      "Deployment failed",
      error instanceof Error ? error.message : String(error),
      "error"
    );
    throw error;
  } finally {
    clearTimeout(executionTimeout);
    clearInterval(progressHeartbeat);
    signal?.removeEventListener("abort", abortFromCaller);
    await flush();
    cleanupStagingDir(deployment.id);
  }
}
