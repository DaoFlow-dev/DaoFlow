import type { AppRole } from "@daoflow/shared";
import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries, events } from "../schema/audit";
import { serverOperationLogs, serverOperations } from "../schema/server-operations";
import { servers } from "../schema/servers";
import { newId } from "./json-helpers";

export type ServerOperationKind =
  | "resource_check"
  | "cleanup_preview"
  | "cleanup_run"
  | "patch_plan"
  | "host_terminal";

export interface ServerOperationActor {
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export async function readServer(serverId: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  return server ?? null;
}

export async function createOperation(input: {
  serverId: string;
  kind: ServerOperationKind;
  dryRun: boolean;
  actor: ServerOperationActor;
  permissionScope: string;
  summary: string;
}) {
  const now = new Date();
  const [operation] = await db
    .insert(serverOperations)
    .values({
      id: newId(),
      serverId: input.serverId,
      kind: input.kind,
      status: "running",
      dryRun: input.dryRun,
      requestedByUserId: input.actor.requestedByUserId,
      requestedByEmail: input.actor.requestedByEmail,
      requestedByRole: input.actor.requestedByRole,
      permissionScope: input.permissionScope,
      summary: input.summary,
      startedAt: now,
      updatedAt: now
    })
    .returning();
  await appendOperationLog(operation.id, "info", input.summary);
  return operation;
}

export async function finishOperation(input: {
  operationId: string;
  status: "completed" | "failed";
  summary: string;
  result?: unknown;
  error?: string | null;
}) {
  const now = new Date();
  const [operation] = await db
    .update(serverOperations)
    .set({
      status: input.status,
      summary: input.summary,
      result: input.result ?? {},
      error: input.error ?? null,
      completedAt: now,
      updatedAt: now
    })
    .where(eq(serverOperations.id, input.operationId))
    .returning();
  await appendOperationLog(
    input.operationId,
    input.status === "completed" ? "info" : "error",
    input.summary
  );
  return operation;
}

export async function appendOperationLog(
  operationId: string,
  stream: "info" | "stdout" | "stderr" | "error",
  message: string,
  metadata?: unknown
) {
  await db.insert(serverOperationLogs).values({
    operationId,
    stream,
    message: message.slice(0, 4000),
    metadata
  });
}

export async function recordOperationAudit(input: {
  operation: typeof serverOperations.$inferSelect;
  server: typeof servers.$inferSelect;
  actor: ServerOperationActor;
  action: string;
  outcome: "success" | "failure";
  summary: string;
}) {
  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.actor.requestedByUserId,
    actorEmail: input.actor.requestedByEmail,
    actorRole: input.actor.requestedByRole,
    targetResource: `server/${input.server.id}`,
    action: input.action,
    inputSummary: input.summary,
    permissionScope: input.operation.permissionScope,
    outcome: input.outcome,
    metadata: {
      resourceType: "server",
      resourceId: input.server.id,
      resourceLabel: input.server.name,
      operationId: input.operation.id,
      operationKind: input.operation.kind,
      detail: input.summary
    }
  });
}

async function recordOperationEvent(input: {
  operation: typeof serverOperations.$inferSelect;
  server: typeof servers.$inferSelect;
  summary: string;
  severity?: "info" | "warning" | "error";
}) {
  await db.insert(events).values({
    kind: `server.${input.operation.kind}.${input.operation.status}`,
    resourceType: "server",
    resourceId: input.server.id,
    summary: input.summary,
    severity: input.severity ?? (input.operation.status === "failed" ? "error" : "info"),
    metadata: {
      serverName: input.server.name,
      operationId: input.operation.id,
      operationKind: input.operation.kind,
      status: input.operation.status
    }
  });
}

export async function runServerOperation<T>(input: {
  serverId: string;
  kind: ServerOperationKind;
  dryRun: boolean;
  actor: ServerOperationActor;
  permissionScope: string;
  startSummary: string;
  successSummary: (result: T) => string;
  action: string;
  execute: (server: typeof servers.$inferSelect) => Promise<T>;
}) {
  const server = await readServer(input.serverId);
  if (!server) return { status: "not_found" as const };

  const operation = await createOperation({
    serverId: server.id,
    kind: input.kind,
    dryRun: input.dryRun,
    actor: input.actor,
    permissionScope: input.permissionScope,
    summary: input.startSummary
  });

  try {
    const result = await input.execute(server);
    const summary = input.successSummary(result);
    const completed = await finishOperation({
      operationId: operation.id,
      status: "completed",
      summary,
      result
    });
    await recordOperationAudit({
      operation: completed,
      server,
      actor: input.actor,
      action: input.action,
      outcome: "success",
      summary
    });
    await recordOperationEvent({ operation: completed, server, summary });
    return { status: "ok" as const, operation: completed, result };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failed = await finishOperation({
      operationId: operation.id,
      status: "failed",
      summary: message,
      error: message
    });
    await recordOperationAudit({
      operation: failed,
      server,
      actor: input.actor,
      action: input.action,
      outcome: "failure",
      summary: message
    });
    await recordOperationEvent({ operation: failed, server, summary: message, severity: "error" });
    return { status: "failed" as const, operation: failed, message };
  }
}

export function serializeOperation(operation: typeof serverOperations.$inferSelect) {
  return {
    ...operation,
    createdAt: operation.createdAt.toISOString(),
    updatedAt: operation.updatedAt.toISOString(),
    startedAt: operation.startedAt?.toISOString() ?? null,
    completedAt: operation.completedAt?.toISOString() ?? null
  };
}

export { desc, eq };
