import { eq } from "drizzle-orm";
import { db } from "../connection";
import { decrypt } from "../crypto";
import { logDrainDeliveries, logDrains } from "../schema/log-drains";
import { newId } from "./json-helpers";

type FetchLike = typeof fetch;
let fetchImpl: FetchLike = fetch;

export function setLogDrainFetchForTests(nextFetch: FetchLike) {
  fetchImpl = nextFetch;
}

export function resetLogDrainFetchForTests() {
  fetchImpl = fetch;
}

export function serializeDelivery(delivery: typeof logDrainDeliveries.$inferSelect) {
  return {
    ...delivery,
    attemptedAt: delivery.attemptedAt.toISOString(),
    completedAt: delivery.completedAt?.toISOString() ?? null
  };
}

function decryptHeaders(headersEncrypted: string | null) {
  if (!headersEncrypted) return {};
  const parsed = JSON.parse(decrypt(headersEncrypted)) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
  const headers: Record<string, string> = {};
  for (const [key, value] of Object.entries(parsed)) {
    if (typeof value === "string") {
      headers[key] = value;
    }
  }
  return headers;
}

export async function sendDrainPayload(drain: typeof logDrains.$inferSelect, payload: unknown) {
  const headers = decryptHeaders(drain.headersEncrypted);
  const response = await fetchImpl(drain.endpointUrl, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "X-DaoFlow-Log-Drain": drain.id,
      ...headers
    },
    body: JSON.stringify(payload),
    signal: AbortSignal.timeout(10_000)
  });
  const responseBody = await response.text();
  return {
    ok: response.ok,
    httpStatus: response.status,
    responseBody: responseBody.slice(0, 2000),
    error: response.ok ? null : responseBody.slice(0, 2000)
  };
}

export async function createDeliveryRow(drainId: string, payload: unknown) {
  const [delivery] = await db
    .insert(logDrainDeliveries)
    .values({
      id: newId(),
      drainId,
      status: "pending",
      payload,
      attemptedAt: new Date()
    })
    .returning();
  return delivery;
}

export async function completeDelivery(
  deliveryId: string,
  result: {
    ok: boolean;
    httpStatus: number | null;
    responseBody?: string | null;
    error?: string | null;
  }
) {
  const [delivery] = await db
    .update(logDrainDeliveries)
    .set({
      status: result.ok ? "delivered" : "failed",
      httpStatus: result.httpStatus === null ? null : String(result.httpStatus),
      responseBody: result.responseBody ?? null,
      error: result.error ?? null,
      completedAt: new Date()
    })
    .where(eq(logDrainDeliveries.id, deliveryId))
    .returning();
  return delivery;
}
