import { and, eq, sql as rawSql } from "drizzle-orm";
import { db } from "../../../db/connection";
import { auditEntries } from "../../../db/schema/audit";
import { deployments } from "../../../db/schema/deployments";
import { cleanupStagingDir } from "../../docker-executor";
import type { DeploymentWorkflowInput } from "../../deployment-workflow-input";
import { runDeployment } from "../../run-deployment";

/**
 * Claim a queued deployment atomically and record an audit entry.
 * Returns null if no deployment is available.
 */
export async function claimQueuedDeployment(): Promise<DeploymentWorkflowInput | null> {
  const [job] = await db
    .update(deployments)
    .set({ status: "prepare", updatedAt: new Date() })
    .where(
      and(
        eq(deployments.status, "queued"),
        eq(
          deployments.id,
          rawSql`(SELECT id FROM ${deployments} WHERE status = 'queued' ORDER BY created_at ASC LIMIT 1 FOR UPDATE SKIP LOCKED)`
        )
      )
    )
    .returning();

  if (!job) return null;

  await db.insert(auditEntries).values({
    actorType: "system",
    actorId: "temporal-worker",
    actorEmail: "system@daoflow.local",
    actorRole: "admin",
    targetResource: `deployment/${job.id}`,
    action: "deployment.execute",
    inputSummary: `Temporal worker claimed deployment ${job.id} for ${job.serviceName}`,
    permissionScope: "deploy:start",
    outcome: "success",
    metadata: {
      resourceType: "deployment",
      resourceId: job.id,
      resourceLabel: job.serviceName,
      detail: `Temporal worker claimed deployment ${job.id}`
    }
  });

  return {
    id: job.id,
    serviceName: job.serviceName,
    sourceType: job.sourceType,
    imageTag: job.imageTag,
    commitSha: job.commitSha,
    configSnapshot: job.configSnapshot
  };
}

export async function runDeploymentActivity(input: DeploymentWorkflowInput): Promise<void> {
  const [deployment] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, input.id))
    .limit(1);

  if (!deployment) {
    throw new Error(`Deployment ${input.id} not found`);
  }

  await runDeployment(deployment, "temporal-worker");
}

/**
 * Clean up staging directory for a deployment.
 */
export function cleanupDeploymentStaging(deploymentId: string): Promise<void> {
  cleanupStagingDir(deploymentId);
  return Promise.resolve();
}
