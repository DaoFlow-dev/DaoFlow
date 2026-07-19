import { ActivityCancellationType, proxyActivities } from "@temporalio/workflow";

import type * as recoveryActivities from "../activities/control-plane-recovery-activities";

const {
  markControlPlaneRecoveryRunning,
  resolveControlPlaneRecoveryKey,
  executeControlPlaneRecoveryBundle,
  markControlPlaneRecoveryVerified,
  markControlPlaneRecoveryFailed
} = proxyActivities<typeof recoveryActivities>({
  startToCloseTimeout: "90 minutes",
  heartbeatTimeout: "2 minutes",
  cancellationType: ActivityCancellationType.WAIT_CANCELLATION_COMPLETED,
  retry: {
    maximumAttempts: 2,
    backoffCoefficient: 2,
    initialInterval: "30s",
    maximumInterval: "5m"
  }
});

export interface ControlPlaneRecoveryWorkflowInput {
  bundleId: string;
}

export interface ControlPlaneRecoveryWorkflowResult {
  bundleId: string;
  status: "verified";
}

/**
 * Temporal history contains only a bundle ID and recovery-key metadata. All
 * credentials, raw keys, and database data remain inside activities.
 */
export async function controlPlaneRecoveryWorkflow(
  input: ControlPlaneRecoveryWorkflowInput
): Promise<ControlPlaneRecoveryWorkflowResult> {
  await markControlPlaneRecoveryRunning(input.bundleId);
  try {
    await resolveControlPlaneRecoveryKey();
    const result = await executeControlPlaneRecoveryBundle(input.bundleId);
    await markControlPlaneRecoveryVerified(result);
    return { bundleId: input.bundleId, status: "verified" };
  } catch (error) {
    try {
      await markControlPlaneRecoveryFailed(input.bundleId, error);
    } catch {
      // The original failure is the only safe error exposed to Temporal.
    }
    throw new Error("Control-plane recovery bundle creation failed.");
  }
}
