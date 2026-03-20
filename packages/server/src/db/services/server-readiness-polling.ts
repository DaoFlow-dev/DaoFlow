import { asc, eq, isNull, lt, or } from "drizzle-orm";
import { db } from "../connection";
import { servers } from "../schema/servers";
import { verifyServerReadiness } from "./server-readiness";
import { resolveServerReadinessPollIntervalMs } from "../../server-readiness-config";

export interface PollServerReadinessOnceOptions {
  intervalMs?: number;
  limit?: number;
  referenceTime?: Date;
}

export async function listServersDueForReadinessCheck(
  options: PollServerReadinessOnceOptions = {}
) {
  const referenceTime = options.referenceTime ?? new Date();
  const intervalMs = options.intervalMs ?? resolveServerReadinessPollIntervalMs();
  const limit = options.limit ?? 8;
  const cutoff = new Date(referenceTime.getTime() - intervalMs);

  return db
    .select()
    .from(servers)
    .where(or(isNull(servers.lastCheckedAt), lt(servers.lastCheckedAt, cutoff)))
    .orderBy(asc(servers.lastCheckedAt), asc(servers.createdAt))
    .limit(limit);
}

export async function pollServerReadinessOnce(options: PollServerReadinessOnceOptions = {}) {
  const intervalMs = options.intervalMs ?? resolveServerReadinessPollIntervalMs();
  const dueServers = await listServersDueForReadinessCheck({
    ...options,
    intervalMs
  });

  let failedCount = 0;
  const checkedServerIds: string[] = [];

  for (const server of dueServers) {
    try {
      await verifyServerReadiness(server);
      checkedServerIds.push(server.id);
    } catch (error) {
      failedCount += 1;
      console.error(
        `[server-readiness] Failed to refresh ${server.name}:`,
        error instanceof Error ? error.message : String(error)
      );
      try {
        await db
          .update(servers)
          .set({ lastCheckedAt: options.referenceTime ?? new Date() })
          .where(eq(servers.id, server.id));
      } catch (dbError) {
        console.error(
          `[server-readiness] Failed to record failure timestamp for ${server.name}:`,
          dbError instanceof Error ? dbError.message : String(dbError)
        );
      }
    }
  }

  return {
    intervalMs,
    checkedCount: checkedServerIds.length,
    failedCount,
    checkedServerIds
  };
}
