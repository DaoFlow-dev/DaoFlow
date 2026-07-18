import { and, count, eq, gt, inArray, lte, sql } from "drizzle-orm";
import { DeploymentLifecycleStatus } from "@daoflow/shared";
import { db } from "../connection";
import { deploymentQueueReservations, deployments } from "../schema/deployments";
import { servers } from "../schema/servers";

export const DEPLOYMENT_QUEUE_FULL = "DEPLOYMENT_QUEUE_FULL" as const;
export const DEPLOYMENT_QUEUE_RESERVATION_TTL_MS = 60 * 60 * 1000;

export type DeploymentCapacityTransaction = Parameters<
  Parameters<(typeof db)["transaction"]>[0]
>[0];

export class DeploymentQueueFullError extends Error {
  readonly code = DEPLOYMENT_QUEUE_FULL;

  constructor(
    readonly details: {
      serverId: string;
      maxQueuedDeployments: number;
      queuedDeploymentCount: number;
    }
  ) {
    super(`Deployment queue for server ${details.serverId} is full.`);
    this.name = "DeploymentQueueFullError";
  }

  get serverId() {
    return this.details.serverId;
  }

  get maxQueuedDeployments() {
    return this.details.maxQueuedDeployments;
  }

  get queuedDeploymentCount() {
    return this.details.queuedDeploymentCount;
  }
}

export class DeploymentQueueReservationUnavailableError extends Error {
  constructor(
    readonly reservationId: string,
    readonly serverId: string
  ) {
    super(`Deployment queue reservation ${reservationId} is unavailable for server ${serverId}.`);
    this.name = "DeploymentQueueReservationUnavailableError";
  }
}

export interface DeploymentQueueReservation {
  id: string;
  serverId: string;
  expiresAt: Date;
}

export async function lockTargetServerForDeploymentCapacity(
  tx: DeploymentCapacityTransaction,
  serverId: string
) {
  const lock = await tx.execute(
    sql`SELECT ${servers.id} FROM ${servers} WHERE ${servers.id} = ${serverId} FOR UPDATE`
  );

  if (!lock.rows[0]) {
    return null;
  }

  const [server] = await tx.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  return server ?? null;
}

export async function countQueuedDeploymentsForServer(
  tx: DeploymentCapacityTransaction,
  serverId: string
) {
  const [result] = await tx
    .select({ queuedDeploymentCount: count() })
    .from(deployments)
    .where(
      and(
        eq(deployments.targetServerId, serverId),
        inArray(deployments.status, [
          DeploymentLifecycleStatus.Queued,
          DeploymentLifecycleStatus.Waiting
        ])
      )
    );

  return Number(result?.queuedDeploymentCount ?? 0);
}

async function countLiveDeploymentQueueReservationsForServer(
  tx: DeploymentCapacityTransaction,
  serverId: string,
  now: Date
) {
  const [result] = await tx
    .select({ liveReservationCount: count() })
    .from(deploymentQueueReservations)
    .where(
      and(
        eq(deploymentQueueReservations.serverId, serverId),
        gt(deploymentQueueReservations.expiresAt, now)
      )
    );

  return Number(result?.liveReservationCount ?? 0);
}

export async function countDeploymentQueueOccupancyForServer(
  tx: DeploymentCapacityTransaction,
  serverId: string,
  now = new Date()
) {
  const queuedDeploymentCount = await countQueuedDeploymentsForServer(tx, serverId);
  const liveReservationCount = await countLiveDeploymentQueueReservationsForServer(
    tx,
    serverId,
    now
  );

  return queuedDeploymentCount + liveReservationCount;
}

async function deleteExpiredDeploymentQueueReservations(
  tx: DeploymentCapacityTransaction,
  serverId: string,
  now: Date
) {
  await tx
    .delete(deploymentQueueReservations)
    .where(
      and(
        eq(deploymentQueueReservations.serverId, serverId),
        lte(deploymentQueueReservations.expiresAt, now)
      )
    );
}

export async function reserveDeploymentQueueSlot(input: {
  reservationId: string;
  serverId: string;
  teamId: string;
  now?: Date;
  ttlMs?: number;
}): Promise<DeploymentQueueReservation> {
  const now = input.now ?? new Date();
  const ttlMs = input.ttlMs ?? DEPLOYMENT_QUEUE_RESERVATION_TTL_MS;
  if (ttlMs <= 0) {
    throw new Error("Deployment queue reservation TTL must be positive.");
  }
  const expiresAt = new Date(now.getTime() + ttlMs);

  return db.transaction(async (tx) => {
    const server = await lockTargetServerForDeploymentCapacity(tx, input.serverId);
    if (!server) {
      throw new Error(`Target server ${input.serverId} was not found.`);
    }
    if (server.teamId !== input.teamId) {
      throw new Error(`Target server ${input.serverId} was not found.`);
    }

    await deleteExpiredDeploymentQueueReservations(tx, input.serverId, now);

    const [existingReservation] = await tx
      .select()
      .from(deploymentQueueReservations)
      .where(eq(deploymentQueueReservations.id, input.reservationId))
      .limit(1);

    if (existingReservation) {
      if (existingReservation.serverId !== input.serverId) {
        throw new Error(
          `Deployment queue reservation ${input.reservationId} belongs to another server.`
        );
      }

      const [renewedReservation] = await tx
        .update(deploymentQueueReservations)
        .set({ expiresAt })
        .where(eq(deploymentQueueReservations.id, input.reservationId))
        .returning({
          id: deploymentQueueReservations.id,
          serverId: deploymentQueueReservations.serverId,
          expiresAt: deploymentQueueReservations.expiresAt
        });

      if (!renewedReservation) {
        throw new Error(`Unable to renew deployment queue reservation ${input.reservationId}.`);
      }

      return renewedReservation;
    }

    const queueOccupancy = await countDeploymentQueueOccupancyForServer(tx, input.serverId, now);
    if (queueOccupancy >= server.maxQueuedDeployments) {
      throw new DeploymentQueueFullError({
        serverId: input.serverId,
        maxQueuedDeployments: server.maxQueuedDeployments,
        queuedDeploymentCount: queueOccupancy
      });
    }

    const [reservation] = await tx
      .insert(deploymentQueueReservations)
      .values({
        id: input.reservationId,
        serverId: input.serverId,
        expiresAt
      })
      .returning({
        id: deploymentQueueReservations.id,
        serverId: deploymentQueueReservations.serverId,
        expiresAt: deploymentQueueReservations.expiresAt
      });

    if (!reservation) {
      throw new Error(`Unable to create deployment queue reservation ${input.reservationId}.`);
    }

    return reservation;
  });
}

export async function consumeDeploymentQueueReservation(
  tx: DeploymentCapacityTransaction,
  input: {
    reservationId: string;
    serverId: string;
    now?: Date;
  }
) {
  const [reservation] = await tx
    .delete(deploymentQueueReservations)
    .where(
      and(
        eq(deploymentQueueReservations.id, input.reservationId),
        eq(deploymentQueueReservations.serverId, input.serverId),
        gt(deploymentQueueReservations.expiresAt, input.now ?? new Date())
      )
    )
    .returning({ id: deploymentQueueReservations.id });

  return reservation !== undefined;
}

export async function releaseDeploymentQueueReservation(input: {
  reservationId: string;
  serverId: string;
  expiresAt?: Date;
}) {
  const conditions = [
    eq(deploymentQueueReservations.id, input.reservationId),
    eq(deploymentQueueReservations.serverId, input.serverId)
  ];
  if (input.expiresAt) {
    conditions.push(eq(deploymentQueueReservations.expiresAt, input.expiresAt));
  }

  await db.delete(deploymentQueueReservations).where(and(...conditions));
}
