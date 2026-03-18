/**
 * temporal-client.ts
 *
 * Temporal client for starting deployment workflows from the API layer.
 * Used by tRPC command routes to dispatch deployments to Temporal instead
 * of relying on DB-polling.
 */

import { Connection, Client } from "@temporalio/client";
import type { DeploymentWorkflowInput } from "../deployment-workflow-input";

let client: Client | null = null;

const TEMPORAL_ADDRESS = process.env.TEMPORAL_ADDRESS ?? "localhost:7233";
const TEMPORAL_NAMESPACE = process.env.TEMPORAL_NAMESPACE ?? "daoflow";
const TEMPORAL_TASK_QUEUE = process.env.TEMPORAL_TASK_QUEUE ?? "daoflow-deployments";

/**
 * Get or create a singleton Temporal client.
 */
export async function getTemporalClient(): Promise<Client> {
  if (client) return client;

  const connection = await Connection.connect({ address: TEMPORAL_ADDRESS });
  client = new Client({ connection, namespace: TEMPORAL_NAMESPACE });
  return client;
}

/**
 * Start a deployment workflow in Temporal.
 *
 * Returns the workflow run ID for tracking in the Temporal UI.
 */
export async function startDeploymentWorkflow(
  input: DeploymentWorkflowInput
): Promise<{ workflowId: string; runId: string }> {
  const tc = await getTemporalClient();

  const handle = await tc.workflow.start("deploymentWorkflow", {
    taskQueue: TEMPORAL_TASK_QUEUE,
    workflowId: `deployment-${input.id}`,
    args: [input],
    // Allow deployment to run up to 30 minutes total
    workflowExecutionTimeout: "30m"
  });

  console.log(
    `[temporal-client] Started deployment workflow: ${handle.workflowId} (run: ${handle.firstExecutionRunId})`
  );

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId
  };
}

/**
 * Get the status of a deployment workflow.
 */
export async function getDeploymentWorkflowStatus(deploymentId: string): Promise<{
  status: string;
  workflowId: string;
} | null> {
  try {
    const tc = await getTemporalClient();
    const handle = tc.workflow.getHandle(`deployment-${deploymentId}`);
    const desc = await handle.describe();

    return {
      status: desc.status.name,
      workflowId: handle.workflowId
    };
  } catch {
    return null;
  }
}

/**
 * Gracefully shut down the Temporal client connection.
 */
export async function closeTemporalClient(): Promise<void> {
  if (client) {
    const connection = client.connection;
    client = null;
    await connection.close();
  }
}

// ── Backup Cron Scheduling ───────────────────────────────────

/**
 * Start a backup cron workflow for a policy.
 * Uses Temporal's built-in cron scheduling with a stable workflow ID.
 */
export async function startBackupCronWorkflow(
  policyId: string,
  cronSchedule: string
): Promise<{ workflowId: string; runId: string }> {
  const tc = await getTemporalClient();

  const workflowId = `backup-cron-${policyId}`;

  const handle = await tc.workflow.start("backupCronWorkflow", {
    taskQueue: TEMPORAL_TASK_QUEUE,
    workflowId,
    args: [{ policyId, triggeredBy: "scheduler" }],
    cronSchedule,
    // Allow backup to run up to 1 hour per execution
    workflowExecutionTimeout: "1h"
  });

  console.log(
    `[temporal-client] Started backup cron workflow: ${handle.workflowId} (schedule: ${cronSchedule})`
  );

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId
  };
}

/**
 * Cancel a backup cron workflow.
 */
export async function cancelBackupCronWorkflow(policyId: string): Promise<void> {
  try {
    const tc = await getTemporalClient();
    const handle = tc.workflow.getHandle(`backup-cron-${policyId}`);
    await handle.cancel();
    console.log(`[temporal-client] Cancelled backup cron for policy: ${policyId}`);
  } catch {
    console.warn(`[temporal-client] No active cron workflow found for policy: ${policyId}`);
  }
}

/**
 * Start a one-off backup workflow (manual trigger, no cron).
 */
export async function startOneOffBackupWorkflow(
  policyId: string,
  triggeredBy: string
): Promise<{ workflowId: string; runId: string }> {
  const tc = await getTemporalClient();

  const workflowId = `backup-oneoff-${policyId}-${Date.now()}`;

  const handle = await tc.workflow.start("backupCronWorkflow", {
    taskQueue: TEMPORAL_TASK_QUEUE,
    workflowId,
    args: [{ policyId, triggeredBy }],
    workflowExecutionTimeout: "1h"
  });

  console.log(`[temporal-client] Started one-off backup: ${handle.workflowId}`);

  return {
    workflowId: handle.workflowId,
    runId: handle.firstExecutionRunId
  };
}

/**
 * Get the status of a backup cron workflow.
 */
export async function getBackupCronStatus(policyId: string): Promise<{
  status: string;
  workflowId: string;
} | null> {
  try {
    const tc = await getTemporalClient();
    const handle = tc.workflow.getHandle(`backup-cron-${policyId}`);
    const desc = await handle.describe();

    return {
      status: desc.status.name,
      workflowId: handle.workflowId
    };
  } catch {
    return null;
  }
}
