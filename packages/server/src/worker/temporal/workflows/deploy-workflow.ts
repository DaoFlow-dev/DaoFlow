/**
 * deploy-workflow.ts
 *
 * Temporal workflow for deployment orchestration. This is deterministic —
 * it calls activities (side-effectful functions) through proxyActivities.
 *
 * If the worker crashes mid-workflow, Temporal replays the execution
 * history and resumes exactly where it left off.
 */

import { proxyActivities, ApplicationFailure, sleep } from "@temporalio/workflow";
import type * as activities from "../activities/deploy-activities";
import type { DeploymentWorkflowInput } from "../../deployment-workflow-input";

const { claimSpecificDeploymentActivity, runDeploymentActivity, cleanupDeploymentStaging } =
  proxyActivities<typeof activities>({
    startToCloseTimeout: "15 minutes",
    retry: {
      maximumAttempts: 3,
      backoffCoefficient: 2,
      initialInterval: "10s",
      maximumInterval: "2m"
    }
  });

/**
 * Main deployment workflow.
 *
 * Orchestrates the full lifecycle: prepare → execute (compose/dockerfile/image) → finalize.
 * Temporal guarantees exactly-once execution and crash recovery.
 */
export async function deploymentWorkflow(input: DeploymentWorkflowInput): Promise<void> {
  const { id } = input;

  try {
    while (true) {
      const claim = await claimSpecificDeploymentActivity(id);
      if (claim.status === "claimed") {
        break;
      }

      if (claim.status === "waiting") {
        await sleep("5 seconds");
        continue;
      }

      if (claim.status === "terminal" || claim.status === "missing") {
        console.log(`[temporal] Deployment ${id} no longer needs execution`);
        return;
      }
    }

    const outcome = await runDeploymentActivity(input);
    if (outcome === "cancelled") {
      console.log(`[temporal] Deployment ${id} cancelled after user request`);
      return;
    }
    console.log(`[temporal] Deployment ${id} completed successfully`);
  } catch (err) {
    if (err instanceof ApplicationFailure) {
      throw err;
    }
    throw err;
  } finally {
    await cleanupDeploymentStaging(id);
  }
}
