import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { servers } from "../db/schema/servers";
import { cleanupStagingDir } from "./docker-executor";
import { resolveExecutionTarget, withPreparedExecutionTarget } from "./execution-target";
import { createLogStreamer } from "./log-streamer";
import { transitionDeployment, emitEvent, readConfig, type DeploymentRow } from "./step-management";
import {
  executeComposeDeployment,
  executeDockerfileDeployment,
  executeImageDeployment
} from "./deploy-strategies";

const DEPLOY_TIMEOUT_MS = Number(process.env.DEPLOY_TIMEOUT_MS ?? 600_000);

export async function runDeployment(deployment: DeploymentRow, actorLabel = "execution-worker") {
  const config = readConfig(deployment);
  const { onLog, flush } = createLogStreamer(deployment.id, actorLabel);

  const projectName = config.projectName ?? deployment.serviceName.replace(/[^a-zA-Z0-9_-]/g, "_");
  const composeProjectName = config.stackName ?? projectName;
  const containerName = `${projectName}-${deployment.serviceName}`.toLowerCase();
  const [server] = await db
    .select()
    .from(servers)
    .where(eq(servers.id, deployment.targetServerId))
    .limit(1);

  if (!server) {
    throw new Error(`Target server ${deployment.targetServerId} not found`);
  }

  const target = resolveExecutionTarget(server, deployment.id);
  const timeoutPromise = new Promise<never>((_, reject) => {
    setTimeout(
      () => reject(new Error(`Deployment timed out after ${DEPLOY_TIMEOUT_MS / 1000}s`)),
      DEPLOY_TIMEOUT_MS
    );
  });

  try {
    await transitionDeployment(deployment.id, "prepare");
    await emitEvent(
      "deployment.prepare.started",
      deployment,
      "Deployment preparation started",
      `${actorLabel} began preparing ${deployment.serviceName}`
    );

    await withPreparedExecutionTarget(target, async (preparedTarget) => {
      if (deployment.sourceType === "compose") {
        await Promise.race([
          executeComposeDeployment(deployment, config, composeProjectName, onLog, preparedTarget),
          timeoutPromise
        ]);
        return;
      }

      if (deployment.sourceType === "dockerfile") {
        await Promise.race([
          executeDockerfileDeployment(deployment, config, containerName, onLog, preparedTarget),
          timeoutPromise
        ]);
        return;
      }

      if (deployment.sourceType === "image") {
        await Promise.race([
          executeImageDeployment(deployment, config, containerName, onLog, preparedTarget),
          timeoutPromise
        ]);
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
  } catch (error) {
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
    await flush();
    cleanupStagingDir(deployment.id);
  }
}
