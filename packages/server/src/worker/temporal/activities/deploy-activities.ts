import { eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import { deployments } from "../../../db/schema/deployments";
import { cleanupStagingDir } from "../../docker-executor";
import type { DeploymentWorkflowInput } from "../../deployment-workflow-input";
import { runDeployment } from "../../run-deployment";
import {
  claimDeploymentForExecution,
  claimNextQueuedDeploymentForExecution
} from "../../../db/services/deployment-execution-control";

/**
 * Claim a queued deployment atomically and record an audit entry.
 * Returns null if no deployment is available.
 */
export async function claimQueuedDeployment(): Promise<DeploymentWorkflowInput | null> {
  const job = await claimNextQueuedDeploymentForExecution({
    actorId: "temporal-worker",
    actorEmail: "system@daoflow.local",
    actorRole: "admin",
    actorLabel: "temporal-worker"
  });

  if (!job) return null;

  return {
    id: job.id,
    serviceName: job.serviceName,
    sourceType: job.sourceType,
    imageTag: job.imageTag,
    commitSha: job.commitSha,
    configSnapshot: job.configSnapshot
  };
}

export async function claimSpecificDeploymentActivity(deploymentId: string): Promise<{
  status: "claimed" | "waiting" | "terminal" | "missing";
}> {
  const result = await claimDeploymentForExecution(deploymentId, {
    actorId: "temporal-worker",
    actorEmail: "system@daoflow.local",
    actorRole: "admin",
    actorLabel: "temporal-worker"
  });

  return { status: result.status };
}

export async function runDeploymentActivity(
  input: DeploymentWorkflowInput
): Promise<"succeeded" | "cancelled"> {
  const [deployment] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, input.id))
    .limit(1);

  if (!deployment) {
    throw new Error(`Deployment ${input.id} not found`);
  }

  return runDeployment(deployment, "temporal-worker");
}

/**
 * Clean up staging directory for a deployment.
 */
export function cleanupDeploymentStaging(deploymentId: string): Promise<void> {
  cleanupStagingDir(deploymentId);
  return Promise.resolve();
}
