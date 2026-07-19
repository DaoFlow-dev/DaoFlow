import { eq } from "drizzle-orm";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { transitionDeploymentWithFeedback } from "./deployment-transition-feedback";
import { startDeploymentWorkflow } from "../../worker/temporal/client";
import { isTemporalEnabled } from "../../worker/temporal/temporal-config";

interface DispatchableDeployment {
  id: string;
  serviceName: string;
  sourceType: string;
  imageTag: string | null;
  commitSha: string | null;
  configSnapshot: unknown;
}

export async function dispatchDeploymentExecution(
  deployment: DispatchableDeployment,
  options?: { preserveDispatchRetry?: boolean }
): Promise<void> {
  if (!isTemporalEnabled()) {
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
    if (options?.preserveDispatchRetry) {
      throw error;
    }

    const now = new Date();
    await transitionDeploymentWithFeedback({
      deploymentId: deployment.id,
      status: "failed",
      conclusion: "failed",
      error,
      now
    });
    throw error;
  }
}
