import { desc, eq, sql } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";
import { asRecord, readString } from "./json-helpers";

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
      deploymentActions: entries.filter((entry) => entry.action.startsWith("deployment.")).length,
      executionActions: entries.filter((entry) => entry.action.startsWith("execution.")).length,
      backupActions: entries.filter((entry) => entry.action.startsWith("backup.")).length,
      humanEntries: entries.filter((entry) => entry.actorType === "user").length
    },
    entries: entries.map((entry) => {
      const metadata = asRecord(entry.metadata);
      const [resourceType = "unknown", ...rest] = entry.targetResource.split("/");

      return {
        ...entry,
        id: readString(metadata, "seedId", `audit_${entry.id}`),
        actorLabel: entry.actorEmail ?? entry.actorId,
        resourceType: readString(metadata, "resourceType", resourceType),
        resourceId: readString(metadata, "resourceId", rest.join("/")),
        resourceLabel: readString(metadata, "resourceLabel", entry.targetResource),
        detail: readString(metadata, "detail", entry.inputSummary ?? ""),
        createdAt: entry.createdAt.toISOString()
      };
    })
  };
}

export async function listOperationsTimeline(deploymentId?: string, limit = 12) {
  const query = deploymentId
    ? db.select().from(events).where(eq(events.resourceId, deploymentId))
    : db.select().from(events);

  const rows = await query.orderBy(desc(events.createdAt)).limit(limit);
  return rows.map((event) => {
    const metadata = asRecord(event.metadata);
    return {
      ...event,
      serviceName: readString(metadata, "serviceName", event.resourceId),
      actorLabel: readString(metadata, "actorLabel"),
      createdAt: event.createdAt.toISOString()
    };
  });
}
