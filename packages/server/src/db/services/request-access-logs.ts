import { and, desc, eq, gte, lt, sql } from "drizzle-orm";
import { parseAuditSinceWindow } from "@daoflow/shared";
import { db } from "../connection";
import { requestAccessLogs } from "../schema/request-access-logs";

export type RequestLogCategory = "auth" | "api" | "trpc" | "webhook" | "health" | "other";

export interface RequestAccessLogInput {
  requestId: string;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  authMethod?: string | null;
  actorType?: string | null;
  actorId?: string | null;
  actorEmail?: string | null;
  actorRole?: string | null;
  tokenId?: string | null;
  tokenPrefix?: string | null;
  sourceIp?: string | null;
  userAgent?: string | null;
  errorCategory?: string | null;
}

export interface RequestAccessLogFilters {
  limit?: number;
  since?: string;
  category?: RequestLogCategory;
  outcome?: "success" | "denied" | "failed";
  failedAuth?: boolean;
  apiTokenOnly?: boolean;
  webhooksOnly?: boolean;
  slowMs?: number;
}

function truncate(value: string | null | undefined, max: number): string | null {
  if (!value) {
    return null;
  }

  return value.length > max ? value.slice(0, max) : value;
}

export function getClientIpFromHeaders(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    "127.0.0.1"
  );
}

export function redactRequestPath(url: string): string {
  try {
    return truncate(new URL(url).pathname, 240) ?? "/";
  } catch {
    const [path = "/"] = url.split("?");
    return truncate(path, 240) ?? "/";
  }
}

export function categorizeRequestPath(path: string): RequestLogCategory {
  if (path.startsWith("/api/auth")) return "auth";
  if (path.startsWith("/api/webhooks")) return "webhook";
  if (path.startsWith("/trpc")) return "trpc";
  if (path === "/health") return "health";
  if (path.startsWith("/api/")) return "api";
  return "other";
}

export function getRequestOutcome(statusCode: number) {
  if (statusCode === 401 || statusCode === 403) return "denied" as const;
  if (statusCode >= 400) return "failed" as const;
  return "success" as const;
}

export function getDefaultErrorCategory(statusCode: number): string | null {
  if (statusCode === 401) return "auth_required";
  if (statusCode === 403) return "scope_denied";
  if (statusCode === 404) return "not_found";
  if (statusCode >= 500) return "server_error";
  if (statusCode >= 400) return "bad_request";
  return null;
}

export async function recordRequestAccessLog(input: RequestAccessLogInput) {
  const path = redactRequestPath(input.url);
  const statusCode = Number.isInteger(input.statusCode) ? input.statusCode : 500;

  await db.insert(requestAccessLogs).values({
    requestId: truncate(input.requestId, 80) ?? "unknown",
    method: truncate(input.method.toUpperCase(), 10) ?? "GET",
    path,
    category: categorizeRequestPath(path),
    statusCode,
    durationMs: Math.max(0, Math.round(input.durationMs)),
    outcome: getRequestOutcome(statusCode),
    errorCategory: truncate(input.errorCategory ?? getDefaultErrorCategory(statusCode), 60),
    authMethod: truncate(input.authMethod, 20),
    actorType: truncate(input.actorType, 20),
    actorId: truncate(input.actorId, 320),
    actorEmail: truncate(input.actorEmail, 320),
    actorRole: truncate(input.actorRole, 20),
    tokenId: truncate(input.tokenId, 32),
    tokenPrefix: truncate(input.tokenPrefix, 12),
    sourceIp: truncate(input.sourceIp, 80),
    userAgent: truncate(input.userAgent, 240),
    metadata: {}
  });
}

export async function listRequestAccessLogs(filters: RequestAccessLogFilters = {}) {
  const limit = Math.min(Math.max(filters.limit ?? 25, 1), 100);
  const cutoff = filters.since ? parseAuditSinceWindow(filters.since) : null;
  const conditions = [];

  if (cutoff) conditions.push(gte(requestAccessLogs.createdAt, cutoff));
  if (filters.category) conditions.push(eq(requestAccessLogs.category, filters.category));
  if (filters.outcome) conditions.push(eq(requestAccessLogs.outcome, filters.outcome));
  if (filters.webhooksOnly) conditions.push(eq(requestAccessLogs.category, "webhook"));
  if (filters.apiTokenOnly) {
    conditions.push(
      sql`(${requestAccessLogs.tokenId} is not null or ${requestAccessLogs.authMethod} = 'api-token')`
    );
  }
  if (filters.slowMs) conditions.push(gte(requestAccessLogs.durationMs, filters.slowMs));
  if (filters.failedAuth) {
    conditions.push(
      sql`(${requestAccessLogs.statusCode} in (401, 403) or ${requestAccessLogs.errorCategory} in ('TOKEN_INVALID', 'TOKEN_REVOKED', 'TOKEN_EXPIRED', 'TOKEN_INVALIDATED', 'auth_required', 'scope_denied'))`
    );
  }

  const where = conditions.length > 0 ? and(...conditions) : undefined;
  const rowsQuery = db.select().from(requestAccessLogs);
  const rows = await (where ? rowsQuery.where(where) : rowsQuery)
    .orderBy(desc(requestAccessLogs.createdAt))
    .limit(limit);
  const summaryQuery = db
    .select({
      totalRequests: sql<number>`count(*)`,
      failedRequests: sql<number>`sum(case when ${requestAccessLogs.outcome} = 'failed' then 1 else 0 end)`,
      deniedRequests: sql<number>`sum(case when ${requestAccessLogs.outcome} = 'denied' then 1 else 0 end)`,
      apiTokenRequests: sql<number>`sum(case when ${requestAccessLogs.tokenId} is not null then 1 else 0 end)`,
      webhookRequests: sql<number>`sum(case when ${requestAccessLogs.category} = 'webhook' then 1 else 0 end)`,
      slowRequests: sql<number>`sum(case when ${requestAccessLogs.durationMs} >= 1000 then 1 else 0 end)`
    })
    .from(requestAccessLogs);
  const [summary] = await (where ? summaryQuery.where(where) : summaryQuery);

  return {
    summary: {
      totalRequests: Number(summary?.totalRequests ?? 0),
      failedRequests: Number(summary?.failedRequests ?? 0),
      deniedRequests: Number(summary?.deniedRequests ?? 0),
      apiTokenRequests: Number(summary?.apiTokenRequests ?? 0),
      webhookRequests: Number(summary?.webhookRequests ?? 0),
      slowRequests: Number(summary?.slowRequests ?? 0)
    },
    entries: rows.map((row) => ({
      ...row,
      id: `reqlog_${row.id}`,
      actorLabel: row.actorEmail ?? row.actorId ?? "anonymous",
      tokenLabel: row.tokenPrefix ? `${row.tokenPrefix}...` : null,
      createdAt: row.createdAt.toISOString()
    }))
  };
}

export async function pruneRequestAccessLogs(retentionDays = 30) {
  const normalizedDays = Math.min(Math.max(Math.floor(retentionDays), 1), 365);
  const cutoff = new Date(Date.now() - normalizedDays * 24 * 60 * 60 * 1000);
  const deleted = await db
    .delete(requestAccessLogs)
    .where(lt(requestAccessLogs.createdAt, cutoff))
    .returning({ id: requestAccessLogs.id });

  return {
    prunedCount: deleted.length,
    cutoff: cutoff.toISOString(),
    retentionDays: normalizedDays
  };
}
