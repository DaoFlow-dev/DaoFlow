import { eq } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { servers } from "../schema/servers";
import { asRecord, readString } from "./json-helpers";
import { buildDockerContainerName } from "../../docker-identifiers";
import { resolveExecutionTarget, withPreparedExecutionTarget } from "../../worker/execution-target";
import {
  cleanupComposeProjectRuntime,
  cleanupContainerRuntime,
  cleanupSwarmStackRuntime
} from "../../worker/runtime-cleanup";

const ACTIVE_DEPLOYMENT_STATUSES = new Set(["queued", "prepare", "deploy", "finalize"]);

type RuntimeCleanupTask =
  | {
      kind: "compose";
      targetServerId: string;
      runtimeName: string;
    }
  | {
      kind: "swarm";
      targetServerId: string;
      runtimeName: string;
    }
  | {
      kind: "container";
      targetServerId: string;
      runtimeName: string;
    };

export type CleanupProjectRuntimeResult =
  | {
      status: "ok";
      cleanedTargets: number;
    }
  | {
      status: "no_runtime";
    }
  | {
      status: "active_deployments" | "cleanup_failed";
      message: string;
    };

function deriveProjectName(deployment: typeof deployments.$inferSelect): string {
  const snapshot = asRecord(deployment.configSnapshot);
  return readString(
    snapshot,
    "projectName",
    deployment.serviceName.replace(/[^a-zA-Z0-9_-]/g, "_")
  );
}

function deriveComposeRuntimeName(deployment: typeof deployments.$inferSelect): string {
  const snapshot = asRecord(deployment.configSnapshot);
  return readString(snapshot, "stackName", deriveProjectName(deployment));
}

function deriveContainerRuntimeName(deployment: typeof deployments.$inferSelect): string {
  if (deployment.containerId?.trim()) {
    return deployment.containerId.trim();
  }

  return buildDockerContainerName(deriveProjectName(deployment), deployment.serviceName);
}

function buildRuntimeCleanupTasks(
  deploymentRows: Array<typeof deployments.$inferSelect>,
  serverKinds: Map<string, string>
): RuntimeCleanupTask[] {
  const uniqueTasks = new Map<string, RuntimeCleanupTask>();

  for (const deployment of deploymentRows) {
    const serverKind = serverKinds.get(deployment.targetServerId) ?? "docker-engine";
    if (deployment.sourceType === "compose") {
      const runtimeName = deriveComposeRuntimeName(deployment);
      const kind = serverKind === "docker-swarm-manager" ? "swarm" : "compose";
      uniqueTasks.set(`${kind}:${deployment.targetServerId}:${runtimeName}`, {
        kind,
        targetServerId: deployment.targetServerId,
        runtimeName
      });
      continue;
    }

    uniqueTasks.set(
      `container:${deployment.targetServerId}:${deriveContainerRuntimeName(deployment)}`,
      {
        kind: "container",
        targetServerId: deployment.targetServerId,
        runtimeName: deriveContainerRuntimeName(deployment)
      }
    );
  }

  return [...uniqueTasks.values()];
}

export async function cleanupProjectRuntime(
  projectId: string
): Promise<CleanupProjectRuntimeResult> {
  const deploymentRows = await db
    .select()
    .from(deployments)
    .where(eq(deployments.projectId, projectId));

  const activeDeployments = deploymentRows.filter((deployment) =>
    ACTIVE_DEPLOYMENT_STATUSES.has(deployment.status)
  );
  if (activeDeployments.length > 0) {
    return {
      status: "active_deployments",
      message:
        "Project deletion is blocked while deployments are still queued or running. Cancel or wait for them to finish first."
    };
  }

  const successfulDeployments = deploymentRows.filter(
    (deployment) => deployment.conclusion === "succeeded"
  );
  if (successfulDeployments.length === 0) {
    return { status: "no_runtime" };
  }

  const targetServerIds = [
    ...new Set(successfulDeployments.map((deployment) => deployment.targetServerId))
  ];
  const serverRows = await db.select().from(servers);
  const serverMap = new Map(
    serverRows
      .filter((server) => targetServerIds.includes(server.id))
      .map((server) => [server.id, server])
  );
  const serverKinds = new Map(
    [...serverMap.values()].map((server) => [server.id, server.kind ?? "docker-engine"])
  );
  const cleanupTasks = buildRuntimeCleanupTasks(successfulDeployments, serverKinds);

  for (const task of cleanupTasks) {
    const server = serverMap.get(task.targetServerId);
    if (!server) {
      return {
        status: "cleanup_failed",
        message: `Target server ${task.targetServerId} could not be resolved for runtime cleanup.`
      };
    }

    const target = resolveExecutionTarget(server, `cleanup_${projectId}_${task.runtimeName}`);

    try {
      await withPreparedExecutionTarget(target, async (preparedTarget) => {
        const onLog = () => undefined;

        if (task.kind === "compose") {
          await cleanupComposeProjectRuntime(preparedTarget, task.runtimeName, onLog);
          return;
        }

        if (task.kind === "swarm") {
          await cleanupSwarmStackRuntime(preparedTarget, task.runtimeName, onLog);
          return;
        }

        await cleanupContainerRuntime(preparedTarget, task.runtimeName, onLog);
      });
    } catch (error) {
      return {
        status: "cleanup_failed",
        message:
          error instanceof Error
            ? `Failed to clean runtime ${task.runtimeName} on ${server.name}: ${error.message}`
            : `Failed to clean runtime ${task.runtimeName} on ${server.name}.`
      };
    }
  }

  return {
    status: "ok",
    cleanedTargets: cleanupTasks.length
  };
}
