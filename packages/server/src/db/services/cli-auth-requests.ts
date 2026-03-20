import { randomBytes } from "node:crypto";
import { and, eq, isNull, lte } from "drizzle-orm";
import { decrypt, encrypt } from "../crypto";
import { db } from "../connection";
import { cliAuthRequests } from "../schema/cli-auth";
import { newId } from "./json-helpers";

export type PendingCliAuthRequest = {
  requestId: string;
  userCode: string;
  exchangeCode: string | null;
  sessionToken: string | null;
  createdAt: number;
  expiresAt: number;
  approvedAt: number | null;
  approvedByUserId: string | null;
  approvedByEmail: string | null;
  exchangedAt: number | null;
};

export const REQUEST_TTL_MS = 10 * 60 * 1000;
export const POLL_INTERVAL_SECONDS = 2;

function createUserCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function createExchangeCode(): string {
  return `dfcli_${randomBytes(12).toString("hex")}`;
}

function mapPendingCliAuthRequest(row: typeof cliAuthRequests.$inferSelect): PendingCliAuthRequest {
  return {
    requestId: row.id,
    userCode: row.userCode,
    exchangeCode: row.exchangeCode,
    sessionToken: row.sessionTokenEncrypted ? decrypt(row.sessionTokenEncrypted) : null,
    createdAt: row.createdAt.getTime(),
    expiresAt: row.expiresAt.getTime(),
    approvedAt: row.approvedAt?.getTime() ?? null,
    approvedByUserId: row.approvedByUserId,
    approvedByEmail: row.approvedByEmail,
    exchangedAt: row.exchangedAt?.getTime() ?? null
  };
}

export async function cleanupExpiredCliAuthRequests(now = new Date()) {
  await db.delete(cliAuthRequests).where(lte(cliAuthRequests.expiresAt, now));
}

export async function createCliAuthRequest(now = new Date()): Promise<PendingCliAuthRequest> {
  await cleanupExpiredCliAuthRequests(now);

  const requestId = newId();
  const request = {
    id: requestId,
    userCode: createUserCode(),
    exchangeCode: null,
    sessionTokenEncrypted: null,
    approvedByUserId: null,
    approvedByEmail: null,
    createdAt: now,
    expiresAt: new Date(now.getTime() + REQUEST_TTL_MS),
    approvedAt: null,
    exchangedAt: null
  } satisfies typeof cliAuthRequests.$inferInsert;

  const [created] = await db.insert(cliAuthRequests).values(request).returning();
  if (!created) {
    throw new Error("Failed to create CLI auth request.");
  }

  return mapPendingCliAuthRequest(created);
}

export async function getCliAuthRequest(
  requestId: string,
  userCode: string,
  now = new Date()
): Promise<PendingCliAuthRequest | null> {
  await cleanupExpiredCliAuthRequests(now);

  const [request] = await db
    .select()
    .from(cliAuthRequests)
    .where(and(eq(cliAuthRequests.id, requestId), eq(cliAuthRequests.userCode, userCode)))
    .limit(1);

  if (!request || request.expiresAt <= now) {
    return null;
  }

  return mapPendingCliAuthRequest(request);
}

export async function approveCliAuthRequest(
  request: PendingCliAuthRequest,
  sessionToken: string,
  approvedByUserId: string,
  approvedByEmail: string,
  now = new Date()
): Promise<PendingCliAuthRequest> {
  if (request.exchangeCode && request.sessionToken) {
    return request;
  }

  const [updated] = await db
    .update(cliAuthRequests)
    .set({
      exchangeCode: createExchangeCode(),
      sessionTokenEncrypted: encrypt(sessionToken),
      approvedByUserId,
      approvedByEmail,
      approvedAt: now
    })
    .where(and(eq(cliAuthRequests.id, request.requestId), isNull(cliAuthRequests.exchangeCode)))
    .returning();

  if (updated) {
    return mapPendingCliAuthRequest(updated);
  }

  const existing = await getCliAuthRequest(request.requestId, request.userCode, now);
  if (existing?.exchangeCode && existing.sessionToken) {
    return existing;
  }

  throw new Error(`CLI auth request "${request.requestId}" is no longer available.`);
}

export async function markCliAuthRequestExchanged(
  request: PendingCliAuthRequest,
  now = new Date()
): Promise<void> {
  await db
    .update(cliAuthRequests)
    .set({ exchangedAt: now })
    .where(and(eq(cliAuthRequests.id, request.requestId), isNull(cliAuthRequests.exchangedAt)));
}
