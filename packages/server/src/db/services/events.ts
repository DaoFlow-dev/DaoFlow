import { desc, gte, sql, type SQL } from "drizzle-orm";
import { db } from "../connection";
import { events } from "../schema/audit";

export async function listEventTimeline(
  limit: number,
  since?: string,
  kind?: string,
  severity?: string
) {
  const conditions: SQL[] = [];

  if (since) {
    const match = /^(\d+)([mhd])$/.exec(since);
    if (match) {
      const value = parseInt(match[1], 10);
      const unit = match[2] === "m" ? "minutes" : match[2] === "h" ? "hours" : "days";
      conditions.push(
        gte(events.createdAt, sql`now() - interval '${sql.raw(`${value} ${unit}`)}'`)
      );
    }
  }

  if (kind) {
    conditions.push(sql`${events.kind} LIKE ${kind.replace("*", "%")}`);
  }

  if (severity) {
    conditions.push(sql`${events.severity} = ${severity}`);
  }

  const rows = await db
    .select()
    .from(events)
    .where(conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined)
    .orderBy(desc(events.createdAt))
    .limit(limit);

  const [countRow] = await db
    .select({ count: sql<number>`count(*)::int` })
    .from(events)
    .where(conditions.length > 0 ? sql`${sql.join(conditions, sql` AND `)}` : undefined);

  return {
    summary: {
      totalEvents: countRow?.count ?? 0,
      returnedEvents: rows.length
    },
    events: rows.map((row) => ({
      id: `event_${row.id}`,
      kind: row.kind,
      resourceType: row.resourceType,
      resourceId: row.resourceId,
      summary: row.summary,
      detail: row.detail,
      severity: row.severity,
      metadata: row.metadata,
      createdAt: row.createdAt.toISOString()
    }))
  };
}
