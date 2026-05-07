import { and, gte } from "drizzle-orm";
import { db } from "../connection";
import { serverOperationLogs, serverOperations } from "../schema/server-operations";
import { asRecord } from "./json-helpers";
import { readServerSwarmTopology } from "./server-topology";
import {
  createOperation,
  desc,
  eq,
  finishOperation,
  readServer,
  recordOperationAudit,
  runServerOperation,
  serializeOperation,
  type ServerOperationActor
} from "./server-operation-runtime";
import {
  collectHostResourceSnapshot,
  type CleanupPreview,
  type CleanupRunResult,
  type PatchPlan,
  planHostPatches,
  previewHostCleanup,
  runHostCleanup
} from "../../worker/server-host-operations";
import { resolveExecutionTarget, withPreparedExecutionTarget } from "../../worker/execution-target";

export type { ServerOperationActor } from "./server-operation-runtime";
export { appendOperationLog } from "./server-operation-runtime";

const CLEANUP_PREVIEW_WINDOW_MS = 30 * 60 * 1000;

export async function getServerOperationsHub(serverId: string, teamId: string, limit = 20) {
  const server = await readServer(serverId);
  if (!server || server.teamId !== teamId) return null;
  const operations = await db
    .select()
    .from(serverOperations)
    .where(eq(serverOperations.serverId, serverId))
    .orderBy(desc(serverOperations.createdAt))
    .limit(limit);
  const latestResource = operations.find((operation) => operation.kind === "resource_check");

  return {
    server: { ...server, swarmTopology: readServerSwarmTopology(server) },
    latestResource: latestResource ? asRecord(latestResource.result) : null,
    operations: operations.map(serializeOperation)
  };
}

export async function getServerOperationLogs(operationId: string, teamId: string, limit = 200) {
  const operationRows = await db
    .select()
    .from(serverOperations)
    .where(eq(serverOperations.id, operationId))
    .limit(1);
  const operation = operationRows[0];
  if (!operation) return null;
  const server = await readServer(operation.serverId);
  if (!server || server.teamId !== teamId) return null;
  const logs = await db
    .select()
    .from(serverOperationLogs)
    .where(eq(serverOperationLogs.operationId, operationId))
    .orderBy(desc(serverOperationLogs.createdAt))
    .limit(limit);
  return {
    operation: serializeOperation(operation),
    logs: logs.reverse().map((log) => ({
      ...log,
      createdAt: log.createdAt.toISOString()
    }))
  };
}

export async function collectServerResources(input: {
  serverId: string;
  teamId: string;
  actor: ServerOperationActor;
}) {
  return runServerOperation({
    serverId: input.serverId,
    teamId: input.teamId,
    kind: "resource_check",
    dryRun: false,
    actor: input.actor,
    permissionScope: "server:read",
    startSummary: "Collecting host resource inventory.",
    action: "server.resources.check",
    successSummary: () => "Collected host CPU, memory, disk, and Docker disk usage.",
    execute: async (server) => {
      const target = await resolveExecutionTarget(server, `serverop_${Date.now()}`, input.teamId);
      return withPreparedExecutionTarget(target, (preparedTarget) =>
        collectHostResourceSnapshot(preparedTarget)
      );
    }
  });
}

export async function previewServerCleanup(input: {
  serverId: string;
  teamId: string;
  includeVolumes?: boolean;
  actor: ServerOperationActor;
}) {
  return runServerOperation({
    serverId: input.serverId,
    teamId: input.teamId,
    kind: "cleanup_preview",
    dryRun: true,
    actor: input.actor,
    permissionScope: "server:write",
    startSummary: "Previewing safe host cleanup.",
    action: "server.cleanup.preview",
    successSummary: (result: CleanupPreview) =>
      `Cleanup preview found ${result.exitedContainers} exited containers, ${result.danglingImages} dangling images, and ${result.buildCacheItems} build cache entries.`,
    execute: async (server) => {
      const target = await resolveExecutionTarget(server, `serverop_${Date.now()}`, input.teamId);
      return withPreparedExecutionTarget(target, (preparedTarget) =>
        previewHostCleanup(preparedTarget, { includeVolumes: input.includeVolumes })
      );
    }
  });
}

export async function runServerCleanup(input: {
  serverId: string;
  teamId: string;
  includeVolumes?: boolean;
  actor: ServerOperationActor;
}) {
  const recentCutoff = new Date(Date.now() - CLEANUP_PREVIEW_WINDOW_MS);
  const [preview] = await db
    .select()
    .from(serverOperations)
    .where(
      and(
        eq(serverOperations.serverId, input.serverId),
        eq(serverOperations.kind, "cleanup_preview"),
        eq(serverOperations.status, "completed"),
        gte(serverOperations.createdAt, recentCutoff)
      )
    )
    .orderBy(desc(serverOperations.createdAt))
    .limit(1);

  if (!preview) {
    return {
      status: "preview_required" as const,
      message: "Run a cleanup preview before executing host cleanup."
    };
  }

  return runServerOperation({
    serverId: input.serverId,
    teamId: input.teamId,
    kind: "cleanup_run",
    dryRun: false,
    actor: input.actor,
    permissionScope: "server:write",
    startSummary: "Running safe host cleanup from the latest preview.",
    action: "server.cleanup.run",
    successSummary: (result: CleanupRunResult) =>
      `Host cleanup completed with ${result.commandResults.filter((entry) => entry.exitCode === 0).length}/${result.commandResults.length} successful commands.`,
    execute: async (server) => {
      const target = await resolveExecutionTarget(server, `serverop_${Date.now()}`, input.teamId);
      return withPreparedExecutionTarget(target, (preparedTarget) =>
        runHostCleanup(preparedTarget, { includeVolumes: input.includeVolumes })
      );
    }
  });
}

export async function planServerPatches(input: {
  serverId: string;
  teamId: string;
  actor: ServerOperationActor;
}) {
  return runServerOperation({
    serverId: input.serverId,
    teamId: input.teamId,
    kind: "patch_plan",
    dryRun: true,
    actor: input.actor,
    permissionScope: "server:write",
    startSummary: "Building host patch plan without applying updates.",
    action: "server.patch.plan",
    successSummary: (result: PatchPlan) => result.summary,
    execute: async (server) => {
      const target = await resolveExecutionTarget(server, `serverop_${Date.now()}`, input.teamId);
      return withPreparedExecutionTarget(target, (preparedTarget) =>
        planHostPatches(preparedTarget)
      );
    }
  });
}

export async function createHostTerminalOperation(input: {
  serverId: string;
  teamId: string;
  shell: "bash" | "sh";
  actor: ServerOperationActor;
}) {
  const server = await readServer(input.serverId);
  if (!server || server.teamId !== input.teamId) return { status: "not_found" as const };

  const operation = await createOperation({
    serverId: server.id,
    kind: "host_terminal",
    dryRun: false,
    actor: input.actor,
    permissionScope: "terminal:open",
    summary: `Opened ${input.shell} host terminal for ${server.name}.`
  });

  await recordOperationAudit({
    operation,
    server,
    actor: input.actor,
    action: "server.terminal.open",
    outcome: "success",
    summary: `Opened ${input.shell} host terminal for ${server.name}.`
  });

  return { status: "ok" as const, operation, server };
}

export async function closeHostTerminalOperation(input: {
  operationId: string;
  exitCode?: number | null;
  actor: ServerOperationActor;
}) {
  const [operation] = await db
    .select()
    .from(serverOperations)
    .where(eq(serverOperations.id, input.operationId))
    .limit(1);
  if (!operation) return { status: "not_found" as const };
  const server = await readServer(operation.serverId);
  if (!server) return { status: "not_found" as const };

  const summary = `Closed host terminal for ${server.name}.`;
  const completed = await finishOperation({
    operationId: operation.id,
    status: "completed",
    summary,
    result: { exitCode: input.exitCode ?? null }
  });

  await recordOperationAudit({
    operation: completed,
    server,
    actor: input.actor,
    action: "server.terminal.close",
    outcome: "success",
    summary
  });

  return { status: "ok" as const, operation: completed };
}
