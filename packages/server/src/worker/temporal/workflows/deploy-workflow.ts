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

const { claimSpecificDeploymentActivity, cleanupDeploymentStaging } = proxyActivities<
  typeof activities
>({
  startToCloseTimeout: "15 minutes",
  retry: {
    maximumAttempts: 3,
    backoffCoefficient: 2,
    initialInterval: "10s",
    maximumInterval: "2m"
  }
});

// A deployment activity starts external build/runtime processes. Retrying it automatically can
// overlap the original attempt after a timeout, so execution is single-attempt until the worker
// has an attempt-aware cancellation and resume protocol.
const { runDeploymentActivity } = proxyActivities<typeof activities>({
  // Keep Temporal's hard activity deadline beyond DaoFlow's default 24-hour aborting
  // execution deadline so the activity can stop its subprocesses and persist failure first.
  startToCloseTimeout: "26 hours",
  heartbeatTimeout: "1 minute",
  retry: { maximumAttempts: 1 }
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
