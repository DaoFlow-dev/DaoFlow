import { eq, desc, gte, and, sql, lt } from "drizzle-orm";
import { db } from "../connection";
import { serverMetrics } from "../schema/server-metrics";
import { servers } from "../schema/servers";
import { newId } from "./json-helpers";
import type { ServerMetricsSnapshot } from "../../worker/server-metrics-collector";

export async function insertServerMetrics(serverId: string, snapshot: ServerMetricsSnapshot) {
  await db.insert(serverMetrics).values({
    id: newId(),
    serverId,
    cpuPercent: snapshot.cpuPercent,
    memoryUsedPercent: snapshot.memoryUsedPercent,
    memoryUsedGB: snapshot.memoryUsedGB,
    memoryTotalGB: snapshot.memoryTotalGB,
    diskUsedPercent: snapshot.diskUsedPercent,
    diskTotalGB: snapshot.diskTotalGB,
    networkInMB: snapshot.networkInMB,
    networkOutMB: snapshot.networkOutMB,
    collectedAt: new Date()
  });
}

export async function getLatestServerMetrics(serverId: string) {
  const [row] = await db
    .select()
    .from(serverMetrics)
    .where(eq(serverMetrics.serverId, serverId))
    .orderBy(desc(serverMetrics.collectedAt))
    .limit(1);
  return row ?? null;
}

export async function listServerMetricsHistory(serverId: string, limit: number, since?: string) {
  const conditions = [eq(serverMetrics.serverId, serverId)];

  if (since) {
    const match = /^(\d+)([mhd])$/.exec(since);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2] === "m" ? "minutes" : match[2] === "h" ? "hours" : "days";
      conditions.push(
        gte(serverMetrics.collectedAt, sql`now() - interval '${sql.raw(`${value} ${unit}`)}'`)
      );
    }
  }

  return db
    .select()
    .from(serverMetrics)
    .where(and(...conditions))
    .orderBy(desc(serverMetrics.collectedAt))
    .limit(limit);
}

export async function listAllServersLatestMetrics() {
  const allServers = await db.select({ id: servers.id, name: servers.name }).from(servers);
  const results = [];
  for (const server of allServers) {
    const latest = await getLatestServerMetrics(server.id);
    if (latest) {
      results.push({ serverName: server.name, ...latest });
    }
  }
  return results;
}

export async function cleanupOldServerMetrics(retentionDays: number) {
  const cutoff = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000);
  await db.delete(serverMetrics).where(lt(serverMetrics.collectedAt, cutoff));
}
