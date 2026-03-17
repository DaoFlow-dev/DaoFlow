import { randomBytes, randomUUID } from "node:crypto";

export type PendingCliAuthRequest = {
  requestId: string;
  userCode: string;
  exchangeCode: string | null;
  sessionToken: string | null;
  createdAt: number;
  expiresAt: number;
  approvedAt: number | null;
  approvedByEmail: string | null;
  exchangedAt: number | null;
};

export const REQUEST_TTL_MS = 10 * 60 * 1000;
export const POLL_INTERVAL_SECONDS = 2;

const pendingCliAuthRequests = new Map<string, PendingCliAuthRequest>();

function createUserCode(): string {
  return randomBytes(4).toString("hex").toUpperCase();
}

function createExchangeCode(): string {
  return `dfcli_${randomBytes(12).toString("hex")}`;
}

export function cleanupExpiredRequests(now = Date.now()) {
  for (const [requestId, request] of pendingCliAuthRequests.entries()) {
    if (request.expiresAt <= now || request.exchangedAt !== null) {
      pendingCliAuthRequests.delete(requestId);
    }
  }
}

export function createCliAuthRequest() {
  cleanupExpiredRequests();

  const requestId = randomUUID();
  const userCode = createUserCode();
  const expiresAt = Date.now() + REQUEST_TTL_MS;

  const request: PendingCliAuthRequest = {
    requestId,
    userCode,
    exchangeCode: null,
    sessionToken: null,
    createdAt: Date.now(),
    expiresAt,
    approvedAt: null,
    approvedByEmail: null,
    exchangedAt: null
  };

  pendingCliAuthRequests.set(requestId, request);
  return request;
}

export function getCliAuthRequest(requestId: string, userCode: string) {
  cleanupExpiredRequests();

  const request = pendingCliAuthRequests.get(requestId);
  if (!request) {
    return null;
  }

  if (request.userCode !== userCode || request.expiresAt <= Date.now()) {
    return null;
  }

  return request;
}

export function approveCliAuthRequest(
  request: PendingCliAuthRequest,
  sessionToken: string,
  approvedByEmail: string
) {
  request.exchangeCode = createExchangeCode();
  request.sessionToken = sessionToken;
  request.approvedAt = Date.now();
  request.approvedByEmail = approvedByEmail;
  return request;
}

export function markCliAuthRequestExchanged(request: PendingCliAuthRequest) {
  request.exchangedAt = Date.now();
}
