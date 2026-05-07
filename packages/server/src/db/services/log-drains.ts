import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { encrypt } from "../crypto";
import { logDrainDeliveries, logDrains } from "../schema/log-drains";
import { asRecord, newId, readString } from "./json-helpers";
import {
  completeDelivery,
  createDeliveryRow,
  resetLogDrainFetchForTests,
  sendDrainPayload,
  serializeDelivery,
  setLogDrainFetchForTests
} from "./log-drain-delivery";
import { recordDrainAudit, recordDrainEvent, type LogDrainActor } from "./log-drain-records";

export { resetLogDrainFetchForTests, setLogDrainFetchForTests };

function serializeDrain(drain: typeof logDrains.$inferSelect) {
  return {
    ...drain,
    hasHeaders: Boolean(drain.headersEncrypted),
    headersEncrypted: undefined,
    lastDeliveredAt: drain.lastDeliveredAt?.toISOString() ?? null,
    createdAt: drain.createdAt.toISOString(),
    updatedAt: drain.updatedAt.toISOString()
  };
}

export async function listLogDrains(teamId: string) {
  const drains = await db
    .select()
    .from(logDrains)
    .where(eq(logDrains.teamId, teamId))
    .orderBy(desc(logDrains.createdAt));
  return drains.map(serializeDrain);
}

export async function listLogDrainDeliveries(teamId: string, limit = 50) {
  const deliveries = await db
    .select({ delivery: logDrainDeliveries })
    .from(logDrainDeliveries)
    .innerJoin(logDrains, eq(logDrainDeliveries.drainId, logDrains.id))
    .where(eq(logDrains.teamId, teamId))
    .orderBy(desc(logDrainDeliveries.attemptedAt))
    .limit(limit);
  return deliveries.map((row) => serializeDelivery(row.delivery));
}

export async function createLogDrain(input: {
  teamId: string;
  name: string;
  destinationType: "webhook" | "generic_http" | "loki" | "s3";
  endpointUrl: string;
  headers?: Record<string, string>;
  serviceFilter?: string | null;
  environmentFilter?: string | null;
  actor: LogDrainActor;
}) {
  const id = newId();
  const [drain] = await db
    .insert(logDrains)
    .values({
      id,
      name: input.name,
      teamId: input.teamId,
      destinationType: input.destinationType,
      endpointUrl: input.endpointUrl,
      headersEncrypted: input.headers ? encrypt(JSON.stringify(input.headers)) : null,
      serviceFilter: input.serviceFilter ?? null,
      environmentFilter: input.environmentFilter ?? null,
      status: "active",
      metadata: {},
      createdAt: new Date(),
      updatedAt: new Date()
    })
    .returning();
  const summary = `Created ${input.destinationType} log drain ${input.name}.`;
  await recordDrainAudit({
    actor: input.actor,
    drainId: drain.id,
    drainName: drain.name,
    action: "log_drain.create",
    summary
  });
  return serializeDrain(drain);
}

export async function deleteLogDrain(input: {
  teamId: string;
  drainId: string;
  actor: LogDrainActor;
}) {
  const [drain] = await db
    .select()
    .from(logDrains)
    .where(and(eq(logDrains.id, input.drainId), eq(logDrains.teamId, input.teamId)))
    .limit(1);
  if (!drain) return null;
  await db.delete(logDrains).where(eq(logDrains.id, input.drainId));
  const summary = `Deleted log drain ${drain.name}.`;
  await recordDrainAudit({
    actor: input.actor,
    drainId: drain.id,
    drainName: drain.name,
    action: "log_drain.delete",
    summary
  });
  return { deleted: true as const, drainId: input.drainId };
}

export async function testLogDrain(input: {
  teamId: string;
  drainId: string;
  actor: LogDrainActor;
}) {
  const [drain] = await db
    .select()
    .from(logDrains)
    .where(and(eq(logDrains.id, input.drainId), eq(logDrains.teamId, input.teamId)))
    .limit(1);
  if (!drain) return null;
  const payload = {
    type: "daoflow.log_drain.test",
    drainId: drain.id,
    drainName: drain.name,
    message: "DaoFlow log drain test delivery.",
    timestamp: new Date().toISOString()
  };
  const delivery = await createDeliveryRow(drain.id, payload);
  try {
    const result = await sendDrainPayload(drain, payload);
    const completed = await completeDelivery(delivery.id, result);
    await db
      .update(logDrains)
      .set({
        lastDeliveredAt: result.ok ? new Date() : drain.lastDeliveredAt,
        lastError: result.ok ? null : result.error,
        updatedAt: new Date()
      })
      .where(eq(logDrains.id, drain.id));
    const summary = `${result.ok ? "Delivered" : "Failed"} test log drain delivery for ${drain.name}.`;
    await recordDrainAudit({
      actor: input.actor,
      drainId: drain.id,
      drainName: drain.name,
      action: "log_drain.test",
      summary,
      outcome: result.ok ? "success" : "failure"
    });
    await recordDrainEvent({
      drainId: drain.id,
      drainName: drain.name,
      kind: result.ok ? "log_drain.delivery.succeeded" : "log_drain.delivery.failed",
      summary,
      severity: result.ok ? "info" : "error"
    });
    return { drain: serializeDrain(drain), delivery: serializeDelivery(completed) };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const completed = await completeDelivery(delivery.id, {
      ok: false,
      httpStatus: null,
      error: message
    });
    await db
      .update(logDrains)
      .set({ lastError: message, updatedAt: new Date() })
      .where(eq(logDrains.id, drain.id));
    const summary = `Failed test log drain delivery for ${drain.name}.`;
    await recordDrainAudit({
      actor: input.actor,
      drainId: drain.id,
      drainName: drain.name,
      action: "log_drain.test",
      summary,
      outcome: "failure"
    });
    await recordDrainEvent({
      drainId: drain.id,
      drainName: drain.name,
      kind: "log_drain.delivery.failed",
      summary,
      severity: "error"
    });
    return { drain: serializeDrain(drain), delivery: serializeDelivery(completed) };
  }
}

export async function retryLogDrainDelivery(input: {
  teamId: string;
  deliveryId: string;
  actor: LogDrainActor;
}) {
  const [delivery] = await db
    .select({ delivery: logDrainDeliveries })
    .from(logDrainDeliveries)
    .innerJoin(logDrains, eq(logDrainDeliveries.drainId, logDrains.id))
    .where(and(eq(logDrainDeliveries.id, input.deliveryId), eq(logDrains.teamId, input.teamId)))
    .limit(1);
  if (!delivery) return null;
  const [drain] = await db
    .select()
    .from(logDrains)
    .where(and(eq(logDrains.id, delivery.delivery.drainId), eq(logDrains.teamId, input.teamId)))
    .limit(1);
  if (!drain) return null;
  const payload = asRecord(delivery.delivery.payload);
  const retryPayload = {
    ...payload,
    retryOf: delivery.delivery.id,
    retriedAt: new Date().toISOString()
  };
  const retry = await createDeliveryRow(drain.id, retryPayload);
  const result = await sendDrainPayload(drain, retryPayload).catch((error: unknown) => ({
    ok: false,
    httpStatus: null,
    responseBody: null,
    error: error instanceof Error ? error.message : String(error)
  }));
  const completed = await completeDelivery(retry.id, result);
  const summary = `${result.ok ? "Retried" : "Failed retry for"} log drain delivery ${delivery.delivery.id}.`;
  await recordDrainAudit({
    actor: input.actor,
    drainId: drain.id,
    drainName: drain.name,
    action: "log_drain.delivery.retry",
    summary,
    outcome: result.ok ? "success" : "failure"
  });
  return {
    originalDeliveryId: delivery.delivery.id,
    drainName: readString(asRecord(drain.metadata), "label", drain.name),
    delivery: serializeDelivery(completed)
  };
}
