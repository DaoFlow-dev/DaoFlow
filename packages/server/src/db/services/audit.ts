import { desc, eq, gte, sql } from "drizzle-orm";
import { parseAuditSinceWindow } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";
import { asRecord, readString } from "./json-helpers";

function getAuditStatusTone(action: string) {
  if (action === "execution.complete" || action === "approval.approve") {
    return "healthy" as const;
  }

  if (action === "execution.fail" || action === "approval.reject") {
    return "failed" as const;
  }

  if (action === "execution.dispatch") {
    return "running" as const;
  }

  return "queued" as const;
}

function getTimelineLifecycleLabel(kind: string) {
  if (kind === "deployment.failed" || kind === "execution.job.failed" || kind === "step.failed") {
    return "failed" as const;
  }

  if (
    kind === "deployment.succeeded" ||
    kind === "execution.job.completed" ||
    kind === "step.completed"
  ) {
    return "completed" as const;
  }

  if (kind === "execution.job.dispatched" || kind === "step.running") {
    return "running" as const;
  }

  return "queued" as const;
}

function getTimelineStatusTone(kind: string) {
  const lifecycle = getTimelineLifecycleLabel(kind);

  if (lifecycle === "failed") {
    return "failed" as const;
  }

  if (lifecycle === "completed") {
    return "healthy" as const;
  }

  return "queued" as const;
}

export async function listAuditTrail(limit = 12, since?: string) {
  const cutoff = since ? parseAuditSinceWindow(since) : null;
  const filter = cutoff ? gte(auditEntries.createdAt, cutoff) : undefined;

  const entriesQuery = db.select().from(auditEntries);
  const entries = await (filter ? entriesQuery.where(filter) : entriesQuery)
    .orderBy(desc(auditEntries.createdAt))
    .limit(limit);

  const summaryQuery = db
    .select({
      totalEntries: sql<number>`count(*)`,
      deploymentActions: sql<number>`
        sum(case when ${auditEntries.action} like 'deployment.%' then 1 else 0 end)
      `,
      executionActions: sql<number>`
        sum(case when ${auditEntries.action} like 'execution.%' then 1 else 0 end)
      `,
      backupActions: sql<number>`
        sum(case when ${auditEntries.action} like 'backup.%' then 1 else 0 end)
      `,
      humanEntries: sql<number>`
        sum(case when ${auditEntries.actorType} = 'user' then 1 else 0 end)
      `
    })
    .from(auditEntries);
  const summaryResult = await (filter ? summaryQuery.where(filter) : summaryQuery);
  const summary = summaryResult[0];

  return {
    summary: {
      totalEntries: Number(summary?.totalEntries ?? 0),
      deploymentActions: Number(summary?.deploymentActions ?? 0),
      executionActions: Number(summary?.executionActions ?? 0),
      backupActions: Number(summary?.backupActions ?? 0),
      humanEntries: Number(summary?.humanEntries ?? 0)
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
        statusTone: getAuditStatusTone(entry.action),
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
      statusLabel: getTimelineLifecycleLabel(event.kind),
      statusTone: getTimelineStatusTone(event.kind),
      createdAt: event.createdAt.toISOString()
    };
  });
}
