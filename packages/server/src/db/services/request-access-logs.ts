import { and, desc, eq, gte, ilike, lt, lte, sql } from "drizzle-orm";
import { parseAuditSinceWindow, type ApiTokenScope } from "@daoflow/shared";
import { db } from "../connection";
import { requestAccessLogs } from "../schema/request-access-logs";
import { apiTokens } from "../schema/tokens";
import { newId } from "./json-helpers";
import type { RequestAccessLogAttribution } from "../../request-access-log-context";

const DEFAULT_ACCESS_LOG_RETENTION_DAYS = 30;
const MAX_USER_AGENT_LENGTH = 255;
const MAX_PATH_LENGTH = 255;

export type AccessLogStatusFilter =
  | "failed-auth"
  | "denied"
  | "error"
  | "slow"
  | "webhook"
  | "api-token";

export interface RecordRequestAccessLogInput {
  requestId: string;
  method: string;
  url: string;
  statusCode: number;
  durationMs: number;
  sourceIp: string;
  userAgent: string | null;
  attribution: RequestAccessLogAttribution | null;
  errorCategory?: string | null;
  now?: Date;
}

export interface ListRequestAccessLogsInput {
  limit?: number;
  cursor?: string;
  since?: string;
  status?: AccessLogStatusFilter;
  method?: string;
  path?: string;
  actorType?: string;
  tokenId?: string;
  requestId?: string;
  search?: string;
  minDurationMs?: number;
}

export function resolveRequestAccessLogRetentionMs(
  rawValue = process.env.REQUEST_ACCESS_LOG_RETENTION_DAYS
): number {
  const parsed = Number(rawValue ?? DEFAULT_ACCESS_LOG_RETENTION_DAYS);
  const days =
    Number.isFinite(parsed) && parsed > 0
      ? Math.min(Math.floor(parsed), 3650)
      : DEFAULT_ACCESS_LOG_RETENTION_DAYS;
  return days * 24 * 60 * 60 * 1000;
}

function splitScopes(scopes: string | null): ApiTokenScope[] {
  return scopes ? (scopes.split(",").filter(Boolean) as ApiTokenScope[]) : [];
}

function joinScopes(scopes: readonly ApiTokenScope[] | null | undefined): string | null {
  return scopes && scopes.length > 0 ? scopes.join(",") : null;
}

function safePathFromUrl(rawUrl: string): string {
  try {
    const url = new URL(rawUrl);
    return url.pathname.slice(0, MAX_PATH_LENGTH);
  } catch {
    return rawUrl.split("?")[0]?.slice(0, MAX_PATH_LENGTH) ?? "/";
  }
}

function categoryForPath(path: string) {
  if (path.startsWith("/api/webhooks")) return "webhook";
  if (path.startsWith("/api/auth")) return "auth";
  if (path.startsWith("/trpc")) return "trpc";
  if (path === "/health") return "health";
  return "api";
}

function outcomeForStatus(statusCode: number, errorCategory: string | null) {
  if (errorCategory === "SCOPE_DENIED" || statusCode === 403) return "denied";
  if (statusCode === 401) return "failed_auth";
  if (statusCode >= 500) return "error";
  if (statusCode >= 400) return "rejected";
  return "success";
}

function mapRow(row: typeof requestAccessLogs.$inferSelect) {
  return {
    id: row.id,
    requestId: row.requestId,
    method: row.method,
    path: row.path,
    category: row.category,
    statusCode: row.statusCode,
    outcome: row.outcome,
    durationMs: row.durationMs,
    authMethod: row.authMethod,
    actorType: row.actorType,
    actorId: row.actorId,
    actorEmail: row.actorEmail,
    actorRole: row.actorRole,
    tokenId: row.tokenId,
    tokenName: row.tokenName,
    tokenPrefix: row.tokenPrefix,
    requiredScopes: splitScopes(row.requiredScopes),
    grantedScopes: splitScopes(row.grantedScopes),
    sourceIp: row.sourceIp,
    userAgent: row.userAgent,
    errorCategory: row.errorCategory,
    metadata: row.metadata,
    createdAt: row.createdAt.toISOString()
  };
}

export async function recordRequestAccessLog(input: RecordRequestAccessLogInput) {
  const attribution = input.attribution;
  const path = safePathFromUrl(input.url);
  const errorCategory = input.errorCategory ?? attribution?.errorCategory ?? null;
  const now = input.now ?? new Date();

  await db.insert(requestAccessLogs).values({
    id: `rlog_${newId()}`.slice(0, 32),
    requestId: input.requestId.slice(0, 80),
    method: input.method.toUpperCase().slice(0, 12),
    path,
    category: categoryForPath(path),
    statusCode: input.statusCode,
    outcome: outcomeForStatus(input.statusCode, errorCategory),
    durationMs: Math.max(0, Math.floor(input.durationMs)),
    authMethod: attribution?.authMethod ?? null,
    actorType: attribution?.actorType ?? null,
    actorId: attribution?.actorId ?? null,
    actorEmail: attribution?.actorEmail ?? null,
    actorRole: attribution?.actorRole ?? null,
    tokenId: attribution?.tokenId ?? null,
    tokenName: attribution?.tokenName ?? null,
    tokenPrefix: attribution?.tokenPrefix ?? null,
    sourceIp: input.sourceIp.slice(0, 80),
    userAgent: input.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null,
    errorCategory,
    requiredScopes: joinScopes(attribution?.requiredScopes),
    grantedScopes: joinScopes(attribution?.grantedScopes),
    metadata: null,
    createdAt: now
  });
}

export async function recordApiTokenSuccess(input: {
  tokenId: string;
  sourceIp?: string | null;
  userAgent?: string | null;
  now?: Date;
}) {
  await db
    .update(apiTokens)
    .set({
      lastUsedAt: input.now ?? new Date(),
      lastUsedIp: input.sourceIp?.slice(0, 80) ?? null,
      lastUsedUserAgent: input.userAgent?.slice(0, MAX_USER_AGENT_LENGTH) ?? null
    })
    .where(eq(apiTokens.id, input.tokenId));
}

export async function recordApiTokenFailure(input: {
  tokenId: string;
  code: string;
  sourceIp?: string | null;
  now?: Date;
}) {
  await db
    .update(apiTokens)
    .set({
      lastFailureAt: input.now ?? new Date(),
      lastFailureCode: input.code.slice(0, 80),
      lastFailureIp: input.sourceIp?.slice(0, 80) ?? null
    })
    .where(eq(apiTokens.id, input.tokenId));
}

export async function listRequestAccessLogs(input: ListRequestAccessLogsInput = {}) {
  const limit = input.limit ?? 50;
  const filters = [];
  const cutoff = input.since ? parseAuditSinceWindow(input.since) : null;
  if (cutoff) filters.push(gte(requestAccessLogs.createdAt, cutoff));
  if (input.cursor) filters.push(lt(requestAccessLogs.createdAt, new Date(input.cursor)));
  if (input.method) filters.push(eq(requestAccessLogs.method, input.method.toUpperCase()));
  if (input.actorType) filters.push(eq(requestAccessLogs.actorType, input.actorType));
  if (input.tokenId) filters.push(eq(requestAccessLogs.tokenId, input.tokenId));
  if (input.requestId) filters.push(eq(requestAccessLogs.requestId, input.requestId));
  if (input.path) filters.push(ilike(requestAccessLogs.path, input.path.replace(/\*/g, "%")));
  if (input.search) {
    const term = `%${input.search}%`;
    filters.push(
      sql`(${requestAccessLogs.requestId} ilike ${term} or ${requestAccessLogs.path} ilike ${term} or ${requestAccessLogs.actorEmail} ilike ${term} or ${requestAccessLogs.tokenName} ilike ${term})`
    );
  }
  if (input.minDurationMs) filters.push(gte(requestAccessLogs.durationMs, input.minDurationMs));
  if (input.status === "failed-auth") filters.push(eq(requestAccessLogs.outcome, "failed_auth"));
  if (input.status === "denied") filters.push(eq(requestAccessLogs.outcome, "denied"));
  if (input.status === "error") filters.push(gte(requestAccessLogs.statusCode, 500));
  if (input.status === "slow") filters.push(gte(requestAccessLogs.durationMs, 1000));
  if (input.status === "webhook") filters.push(eq(requestAccessLogs.category, "webhook"));
  if (input.status === "api-token") filters.push(eq(requestAccessLogs.authMethod, "api-token"));

  const where = filters.length > 0 ? and(...filters) : undefined;
  const query = db.select().from(requestAccessLogs);
  const rows = await (where ? query.where(where) : query)
    .orderBy(desc(requestAccessLogs.createdAt))
    .limit(limit + 1);
  const entries = rows.slice(0, limit);
  const summaryQuery = db
    .select({
      totalEntries: sql<number>`count(*)`,
      failedAuth: sql<number>`sum(case when ${requestAccessLogs.outcome} = 'failed_auth' then 1 else 0 end)`,
      deniedScopes: sql<number>`sum(case when ${requestAccessLogs.outcome} = 'denied' then 1 else 0 end)`,
      webhookRequests: sql<number>`sum(case when ${requestAccessLogs.category} = 'webhook' then 1 else 0 end)`,
      apiTokenRequests: sql<number>`sum(case when ${requestAccessLogs.authMethod} = 'api-token' then 1 else 0 end)`,
      slowRequests: sql<number>`sum(case when ${requestAccessLogs.durationMs} >= 1000 then 1 else 0 end)`,
      errorResponses: sql<number>`sum(case when ${requestAccessLogs.statusCode} >= 500 then 1 else 0 end)`
    })
    .from(requestAccessLogs);
  const [summary] = await (where ? summaryQuery.where(where) : summaryQuery);

  return {
    limit,
    cursor: input.cursor ?? null,
    nextCursor: rows.length > limit ? (entries.at(-1)?.createdAt.toISOString() ?? null) : null,
    filters: {
      status: input.status ?? null,
      method: input.method ?? null,
      path: input.path ?? null,
      actorType: input.actorType ?? null,
      tokenId: input.tokenId ?? null,
      requestId: input.requestId ?? null,
      since: input.since ?? null,
      search: input.search ?? null,
      minDurationMs: input.minDurationMs ?? null
    },
    summary: {
      totalEntries: Number(summary?.totalEntries ?? 0),
      failedAuth: Number(summary?.failedAuth ?? 0),
      deniedScopes: Number(summary?.deniedScopes ?? 0),
      webhookRequests: Number(summary?.webhookRequests ?? 0),
      apiTokenRequests: Number(summary?.apiTokenRequests ?? 0),
      slowRequests: Number(summary?.slowRequests ?? 0),
      errorResponses: Number(summary?.errorResponses ?? 0)
    },
    retentionDays: Math.floor(resolveRequestAccessLogRetentionMs() / 86_400_000),
    entries: entries.map(mapRow)
  };
}

export async function countPrunableRequestAccessLogs(now = new Date()) {
  const cutoff = new Date(now.getTime() - resolveRequestAccessLogRetentionMs());
  const [row] = await db
    .select({ count: sql<number>`count(*)` })
    .from(requestAccessLogs)
    .where(lte(requestAccessLogs.createdAt, cutoff));
  return Number(row?.count ?? 0);
}

export async function pruneRequestAccessLogs(now = new Date()) {
  const cutoff = new Date(now.getTime() - resolveRequestAccessLogRetentionMs());
  const rows = await db
    .delete(requestAccessLogs)
    .where(lte(requestAccessLogs.createdAt, cutoff))
    .returning({ id: requestAccessLogs.id });
  return rows.length;
}
