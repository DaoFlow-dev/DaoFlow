import { and, eq, inArray } from "drizzle-orm";
import { DeploymentLifecycleStatus } from "@daoflow/shared";
import { db } from "../connection";
import { deploymentBuildLeases, deployments } from "../schema/deployments";
import { queueProviderFeedbackIntent } from "./provider-feedback-intents";

export async function markDeploymentWaitingForBuildSlot(
  deploymentId: string,
  now = new Date()
): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(deployments)
      .set({ status: DeploymentLifecycleStatus.Waiting, updatedAt: now })
      .where(
        and(
          eq(deployments.id, deploymentId),
          inArray(deployments.status, [
            DeploymentLifecycleStatus.Waiting,
            DeploymentLifecycleStatus.Prepare,
            DeploymentLifecycleStatus.Deploy
          ])
        )
      )
      .returning({ id: deployments.id });
    if (updated) {
      await queueProviderFeedbackIntent(tx, {
        deploymentId: updated.id,
        transition: DeploymentLifecycleStatus.Waiting,
        now
      });
    }
  });
}

export async function markDeploymentBuildSlotAcquired(
  deploymentId: string,
  now = new Date()
): Promise<void> {
  await db.transaction(async (tx) => {
    const [updated] = await tx
      .update(deployments)
      .set({ status: DeploymentLifecycleStatus.Deploy, updatedAt: now })
      .where(
        and(
          eq(deployments.id, deploymentId),
          inArray(deployments.status, [
            DeploymentLifecycleStatus.Waiting,
            DeploymentLifecycleStatus.Prepare,
            DeploymentLifecycleStatus.Deploy
          ])
        )
      )
      .returning({ id: deployments.id });
    if (updated) {
      await queueProviderFeedbackIntent(tx, {
        deploymentId: updated.id,
        transition: DeploymentLifecycleStatus.Deploy,
        now
      });
    }
  });
}

export async function releaseDeploymentBuildLease(input: {
  deploymentId: string;
  serverId: string;
  ownerToken: string;
}): Promise<void> {
  await db
    .delete(deploymentBuildLeases)
    .where(
      and(
        eq(deploymentBuildLeases.deploymentId, input.deploymentId),
        eq(deploymentBuildLeases.serverId, input.serverId),
        eq(deploymentBuildLeases.ownerToken, input.ownerToken)
      )
    );
}

export async function isDeploymentActiveForBuild(deploymentId: string): Promise<boolean> {
  const [deployment] = await db
    .select({ status: deployments.status })
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);

  return Boolean(
    deployment &&
    deployment.status !== DeploymentLifecycleStatus.Completed &&
    deployment.status !== DeploymentLifecycleStatus.Failed
  );
}
