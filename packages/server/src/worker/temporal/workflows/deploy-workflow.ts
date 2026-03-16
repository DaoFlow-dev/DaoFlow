/**
 * deploy-workflow.ts
 *
 * Temporal workflow for deployment orchestration. This is deterministic —
 * it calls activities (side-effectful functions) through proxyActivities.
 *
 * If the worker crashes mid-workflow, Temporal replays the execution
 * history and resumes exactly where it left off.
 */

import { proxyActivities, ApplicationFailure } from "@temporalio/workflow";
import type * as activities from "../activities/deploy-activities";

const {
  transitionDeployment,
  emitDeploymentEvent,
  executeComposeDeployment,
  executeDockerfileDeployment,
  executeImageDeployment,
  cleanupDeploymentStaging
} = proxyActivities<typeof activities>({
  startToCloseTimeout: "15 minutes",
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    initialInterval: "10s",
    maximumInterval: "2m"
  }
});

export interface DeploymentWorkflowInput {
  id: string;
  serviceName: string;
  sourceType: string;
  imageTag: string | null;
  commitSha: string | null;
  configSnapshot: unknown;
}

/**
 * Main deployment workflow.
 *
 * Orchestrates the full lifecycle: prepare → execute (compose/dockerfile/image) → finalize.
 * Temporal guarantees exactly-once execution and crash recovery.
 */
export async function deploymentWorkflow(input: DeploymentWorkflowInput): Promise<void> {
  const { id, serviceName, sourceType } = input;

  try {
    // Phase 1: Prepare
    await transitionDeployment(id, "prepare");
    await emitDeploymentEvent(
      id,
      serviceName,
      "deployment.prepare.started",
      "Deployment preparation started",
      `Temporal worker began preparing ${serviceName}`
    );

    // Phase 2: Execute based on source type
    if (sourceType === "compose") {
      await executeComposeDeployment(input);
    } else if (sourceType === "dockerfile") {
      await executeDockerfileDeployment(input);
    } else if (sourceType === "image") {
      await executeImageDeployment(input);
    } else {
      throw ApplicationFailure.nonRetryable(`Unsupported source type: ${sourceType}`);
    }

    // Phase 3: Finalize — success
    await transitionDeployment(id, "completed", "succeeded");
    await emitDeploymentEvent(
      id,
      serviceName,
      "deployment.succeeded",
      "Deployment completed successfully",
      `${serviceName} is now running`
    );

    console.log(`[temporal] Deployment ${id} completed successfully`);
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    console.error(`[temporal] Deployment ${id} failed:`, message);

    await transitionDeployment(id, "failed", "failed", message);
    await emitDeploymentEvent(
      id,
      serviceName,
      "deployment.failed",
      "Deployment failed",
      message,
      "error"
    );

    // Re-throw so Temporal records the workflow as failed
    throw err;
  } finally {
    await cleanupDeploymentStaging(id);
  }
}
