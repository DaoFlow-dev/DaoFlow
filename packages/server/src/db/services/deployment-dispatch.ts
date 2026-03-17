import { eq } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { startDeploymentWorkflow } from "../../worker/temporal/client";

interface DispatchableDeployment {
  id: string;
  serviceName: string;
  sourceType: string;
  imageTag: string | null;
  commitSha: string | null;
  configSnapshot: unknown;
}

function isTemporalDispatchEnabled(): boolean {
  return process.env.DAOFLOW_ENABLE_TEMPORAL === "true" && !!process.env.TEMPORAL_ADDRESS;
}

export async function dispatchDeploymentExecution(
  deployment: DispatchableDeployment
): Promise<void> {
  if (!isTemporalDispatchEnabled()) {
    return;
  }

  try {
    const workflow = await startDeploymentWorkflow({
      id: deployment.id,
      serviceName: deployment.serviceName,
      sourceType: deployment.sourceType,
      imageTag: deployment.imageTag,
      commitSha: deployment.commitSha,
      configSnapshot: deployment.configSnapshot
    });

    const snapshot =
      deployment.configSnapshot && typeof deployment.configSnapshot === "object"
        ? deployment.configSnapshot
        : {};

    await db
      .update(deployments)
      .set({
        configSnapshot: {
          ...snapshot,
          temporalWorkflowId: workflow.workflowId,
          temporalRunId: workflow.runId
        },
        updatedAt: new Date()
      })
      .where(eq(deployments.id, deployment.id));
  } catch (error) {
    const now = new Date();
    await db
      .update(deployments)
      .set({
        status: "failed",
        conclusion: "failed",
        concludedAt: now,
        error:
          error instanceof Error
            ? { message: error.message, stack: error.stack }
            : { message: String(error) },
        updatedAt: now
      })
      .where(eq(deployments.id, deployment.id));
    throw error;
  }
}
