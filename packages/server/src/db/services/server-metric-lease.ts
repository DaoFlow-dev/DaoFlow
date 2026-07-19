import { and, eq, isNull, lte, or, sql } from "drizzle-orm";
import { db } from "../connection";
import { serverMetricStates } from "../schema/server-metrics";
import { newId } from "./json-helpers";

const DEFAULT_COLLECTION_LEASE_MS = 2 * 60_000;

export interface ServerMetricCollectionLease {
  serverId: string;
  owner: string;
  token: string;
  generation: number;
  expiresAt: Date;
}

export function getServerMetricCollectionLeaseDurationMs() {
  const parsed = Number.parseInt(process.env.DAOFLOW_SERVER_METRIC_COLLECTION_LEASE_MS ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 5_000 ? parsed : DEFAULT_COLLECTION_LEASE_MS;
}

/**
 * Claims a due server only if the state generation observed by the caller is
 * still current. This closes the gap between the due query and collection.
 */
export async function claimServerMetricCollection(input: {
  serverId: string;
  expectedGeneration: number;
  owner: string;
  now: Date;
  leaseDurationMs?: number;
}): Promise<ServerMetricCollectionLease | null> {
  const token = newId();
  const expiresAt = new Date(
    input.now.getTime() + (input.leaseDurationMs ?? getServerMetricCollectionLeaseDurationMs())
  );
  const [claimed] = await db
    .insert(serverMetricStates)
    .values({
      serverId: input.serverId,
      currentState: "healthy",
      metricStates: {},
      collectionGeneration: 1,
      collectionLeaseOwner: input.owner,
      collectionLeaseToken: token,
      collectionLeaseExpiresAt: expiresAt,
      updatedAt: input.now
    })
    .onConflictDoUpdate({
      target: serverMetricStates.serverId,
      set: {
        collectionGeneration: sql`${serverMetricStates.collectionGeneration} + 1`,
        collectionLeaseOwner: input.owner,
        collectionLeaseToken: token,
        collectionLeaseExpiresAt: expiresAt,
        updatedAt: input.now
      },
      where: and(
        eq(serverMetricStates.collectionGeneration, input.expectedGeneration),
        or(
          isNull(serverMetricStates.collectionLeaseExpiresAt),
          lte(serverMetricStates.collectionLeaseExpiresAt, input.now)
        )
      )
    })
    .returning({ generation: serverMetricStates.collectionGeneration });

  if (!claimed) return null;
  return {
    serverId: input.serverId,
    owner: input.owner,
    token,
    generation: claimed.generation,
    expiresAt
  };
}

export function isCurrentServerMetricCollectionLease(
  row: Pick<
    typeof serverMetricStates.$inferSelect,
    | "serverId"
    | "collectionGeneration"
    | "collectionLeaseOwner"
    | "collectionLeaseToken"
    | "collectionLeaseExpiresAt"
  >,
  lease: ServerMetricCollectionLease,
  now: Date
) {
  return Boolean(
    row.serverId === lease.serverId &&
    row.collectionGeneration === lease.generation &&
    row.collectionLeaseOwner === lease.owner &&
    row.collectionLeaseToken === lease.token &&
    row.collectionLeaseExpiresAt &&
    row.collectionLeaseExpiresAt.getTime() > now.getTime()
  );
}
