import { desc, eq, sql } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";

export async function listAuditTrail(limit = 12) {
  const entries = await db
    .select()
    .from(auditEntries)
    .orderBy(desc(auditEntries.createdAt))
    .limit(limit);

  const totalResult = await db.select({ count: sql<number>`count(*)` }).from(auditEntries);
  const total = Number(totalResult[0]?.count ?? 0);

  return {
    summary: {
      totalEntries: total,
      deploymentActions: entries.filter((e) => e.action.startsWith("deployment.")).length,
      executionActions: entries.filter((e) => e.action.startsWith("execution.")).length,
      backupActions: entries.filter((e) => e.action.startsWith("backup.")).length,
      humanEntries: entries.filter((e) => e.actorType === "user").length
    },
    entries: entries.map((e) => {
      const parts = e.targetResource.split("/");
      return {
        ...e,
        actorLabel: e.actorEmail ?? e.actorId,
        resourceType: parts[0] ?? "unknown",
        resourceId: parts.slice(1).join("/") ?? "",
        resourceLabel: e.targetResource,
        detail: e.inputSummary ?? "",
        createdAt: e.createdAt.toISOString()
      };
    })
  };
}

export async function listOperationsTimeline(deploymentId?: string, limit = 12) {
  const query = deploymentId
    ? db.select().from(events).where(eq(events.resourceId, deploymentId))
    : db.select().from(events);

  const rows = await query.orderBy(desc(events.createdAt)).limit(limit);
  return rows.map((e) => ({
    ...e,
    serviceName: e.resourceId,
    createdAt: e.createdAt.toISOString()
  }));
}
