import { and, asc, count, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { DeploymentConclusion, DeploymentLifecycleStatus } from "@daoflow/shared";
import { db } from "../connection";
import { deploymentBuildLeases, deployments } from "../schema/deployments";
import { lockTargetServerForDeploymentCapacity } from "./deployment-capacity";

export const DEFAULT_BUILD_LEASE_DURATION_MS = 120_000;

function buildLeaseTimestamps(now: Date | undefined, leaseDurationMs: number) {
  if (now) {
    return {
      heartbeatAt: now,
      expiresAt: new Date(now.getTime() + leaseDurationMs)
    };
  }

  return {
    heartbeatAt: sql<Date>`clock_timestamp()`,
    expiresAt: sql<Date>`clock_timestamp() + (${leaseDurationMs} * interval '1 millisecond')`
  };
}

export type DeploymentBuildLeaseAcquireResult =
  | {
      status: "acquired";
      capacity: number;
      activeLeaseCount: number;
      renewed: boolean;
    }
  | {
      status: "waiting";
      capacity: number;
      activeLeaseCount: number;
      queuePosition: number;
    }
  | { status: "server-not-found" };

export async function tryAcquireDeploymentBuildLease(input: {
  deploymentId: string;
  serverId: string;
  ownerToken: string;
  now?: Date;
  leaseDurationMs?: number;
}): Promise<DeploymentBuildLeaseAcquireResult> {
  return db.transaction(async (tx) => {
    const server = await lockTargetServerForDeploymentCapacity(tx, input.serverId);
    if (!server) {
      return { status: "server-not-found" };
    }
    const now = input.now ?? new Date();
    const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_BUILD_LEASE_DURATION_MS;

    const expiredLeases = await tx
      .select({ deploymentId: deploymentBuildLeases.deploymentId })
      .from(deploymentBuildLeases)
      .where(
        and(
          eq(deploymentBuildLeases.serverId, input.serverId),
          lte(deploymentBuildLeases.expiresAt, now)
        )
      );
    await tx
      .delete(deploymentBuildLeases)
      .where(
        and(
          eq(deploymentBuildLeases.serverId, input.serverId),
          lte(deploymentBuildLeases.expiresAt, now)
        )
      );
    const abandonedDeploymentIds = expiredLeases
      .map((lease) => lease.deploymentId)
      .filter((deploymentId) => deploymentId !== input.deploymentId);
    if (abandonedDeploymentIds.length > 0) {
      await tx
        .update(deployments)
        .set({
          status: DeploymentLifecycleStatus.Failed,
          conclusion: DeploymentConclusion.Failed,
          error: {
            code: "BUILD_LEASE_EXPIRED",
            message: "The build worker stopped renewing its capacity lease."
          },
          concludedAt: now,
          updatedAt: now
        })
        .where(
          and(
            inArray(deployments.id, abandonedDeploymentIds),
            inArray(deployments.status, [
              DeploymentLifecycleStatus.Waiting,
              DeploymentLifecycleStatus.Prepare,
              DeploymentLifecycleStatus.Deploy
            ])
          )
        );
    }

    const [existingLease] = await tx
      .select()
      .from(deploymentBuildLeases)
      .where(eq(deploymentBuildLeases.deploymentId, input.deploymentId))
      .limit(1);

    if (existingLease) {
      if (existingLease.serverId !== input.serverId) {
        throw new Error(
          `Deployment ${input.deploymentId} already holds a build lease on another server.`
        );
      }

      if (existingLease.ownerToken !== input.ownerToken) {
        const activeLeases = await tx
          .select({ deploymentId: deploymentBuildLeases.deploymentId })
          .from(deploymentBuildLeases)
          .where(
            and(
              eq(deploymentBuildLeases.serverId, input.serverId),
              gt(deploymentBuildLeases.expiresAt, now)
            )
          );

        return {
          status: "waiting",
          capacity: server.maxConcurrentBuilds,
          activeLeaseCount: activeLeases.length,
          queuePosition: 1
        };
      }

      const leaseTimestamps = buildLeaseTimestamps(input.now, leaseDurationMs);
      const [activeLease] = await tx
        .update(deploymentBuildLeases)
        .set(leaseTimestamps)
        .where(
          and(
            eq(deploymentBuildLeases.deploymentId, input.deploymentId),
            eq(deploymentBuildLeases.ownerToken, input.ownerToken)
          )
        )
        .returning({ deploymentId: deploymentBuildLeases.deploymentId });

      if (!activeLease) {
        throw new Error(`Failed to renew build lease for deployment ${input.deploymentId}.`);
      }

      const [leaseCount] = await tx
        .select({ activeLeaseCount: count() })
        .from(deploymentBuildLeases)
        .where(eq(deploymentBuildLeases.serverId, input.serverId));

      return {
        status: "acquired",
        capacity: server.maxConcurrentBuilds,
        activeLeaseCount: Number(leaseCount?.activeLeaseCount ?? 0),
        renewed: true
      };
    }

    const activeLeases = await tx
      .select({ deploymentId: deploymentBuildLeases.deploymentId })
      .from(deploymentBuildLeases)
      .where(
        and(
          eq(deploymentBuildLeases.serverId, input.serverId),
          gt(deploymentBuildLeases.expiresAt, now)
        )
      );
    const activeLeaseIds = new Set(activeLeases.map((lease) => lease.deploymentId));
    const activeLeaseCount = activeLeases.length;
    const waitingDeployments = await tx
      .select({ id: deployments.id })
      .from(deployments)
      .where(
        and(
          eq(deployments.targetServerId, input.serverId),
          eq(deployments.status, DeploymentLifecycleStatus.Waiting)
        )
      )
      .orderBy(asc(deployments.createdAt), asc(deployments.id));
    const waitingQueue = waitingDeployments.filter(
      (deployment) => !activeLeaseIds.has(deployment.id)
    );
    const queueIndex = waitingQueue.findIndex((deployment) => deployment.id === input.deploymentId);
    const queuePosition = queueIndex >= 0 ? queueIndex + 1 : waitingQueue.length + 1;
    const availableSlots = Math.max(0, server.maxConcurrentBuilds - activeLeaseCount);

    if (activeLeaseCount >= server.maxConcurrentBuilds || queuePosition > availableSlots) {
      return {
        status: "waiting",
        capacity: server.maxConcurrentBuilds,
        activeLeaseCount,
        queuePosition
      };
    }

    const leaseTimestamps = buildLeaseTimestamps(input.now, leaseDurationMs);
    await tx.insert(deploymentBuildLeases).values({
      deploymentId: input.deploymentId,
      serverId: input.serverId,
      ownerToken: input.ownerToken,
      acquiredAt: leaseTimestamps.heartbeatAt,
      ...leaseTimestamps
    });

    return {
      status: "acquired",
      capacity: server.maxConcurrentBuilds,
      activeLeaseCount: activeLeaseCount + 1,
      renewed: false
    };
  });
}

export async function renewDeploymentBuildLease(input: {
  deploymentId: string;
  serverId: string;
  ownerToken: string;
  now?: Date;
  leaseDurationMs?: number;
}): Promise<boolean> {
  return db.transaction(async (tx) => {
    const leaseLock = await tx.execute(
      sql`SELECT ${deploymentBuildLeases.deploymentId}
          FROM ${deploymentBuildLeases}
          WHERE ${deploymentBuildLeases.deploymentId} = ${input.deploymentId}
            AND ${deploymentBuildLeases.serverId} = ${input.serverId}
            AND ${deploymentBuildLeases.ownerToken} = ${input.ownerToken}
          FOR UPDATE`
    );
    if (!leaseLock.rows[0]) return false;

    const leaseDurationMs = input.leaseDurationMs ?? DEFAULT_BUILD_LEASE_DURATION_MS;
    const deploymentHeartbeatAt = input.now ?? sql<Date>`clock_timestamp()`;
    await tx
      .update(deployments)
      .set({ updatedAt: deploymentHeartbeatAt })
      .where(eq(deployments.id, input.deploymentId));

    // Make the lease update the final database statement and derive its expiry from
    // PostgreSQL's live clock at that statement. Lock waits and earlier work therefore
    // cannot consume the renewed lifetime before the caller rearms its local watchdog.
    const leaseTimestamps = buildLeaseTimestamps(input.now, leaseDurationMs);
    const [renewed] = await tx
      .update(deploymentBuildLeases)
      .set(leaseTimestamps)
      .where(
        and(
          eq(deploymentBuildLeases.deploymentId, input.deploymentId),
          eq(deploymentBuildLeases.serverId, input.serverId),
          eq(deploymentBuildLeases.ownerToken, input.ownerToken)
        )
      )
      .returning({ deploymentId: deploymentBuildLeases.deploymentId });

    if (!renewed) return false;
    return true;
  });
}

export {
  isDeploymentActiveForBuild,
  markDeploymentBuildSlotAcquired,
  markDeploymentWaitingForBuildSlot,
  releaseDeploymentBuildLease
} from "./deployment-build-lease-state";
