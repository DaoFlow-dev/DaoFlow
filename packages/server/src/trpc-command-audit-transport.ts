import type { Context } from "./context";
import {
  beginCommandAudit,
  finishCommandAudit,
  type CommandAuditContract
} from "./db/services/command-audit";
import { getCommandAuditActor } from "./trpc-command-audit";

interface AuditableProcedure {
  _def: {
    type: string;
    meta?: unknown;
  };
}

interface AuditableRouter {
  _def: { procedures: Record<string, AuditableProcedure> };
}

function readProcedurePaths(pathname: string): string[] {
  const marker = "/trpc/";
  const markerIndex = pathname.indexOf(marker);
  if (markerIndex < 0) return [];

  const encoded = pathname.slice(markerIndex + marker.length);
  try {
    return decodeURIComponent(encoded)
      .split(",")
      .map((path) => path.trim())
      .filter(Boolean);
  } catch {
    return [];
  }
}

export async function prepareTransportCommandAudits(input: {
  method: string;
  pathname: string;
  context: Context;
  router: AuditableRouter;
}): Promise<void> {
  if (input.method !== "POST") return;

  const paths = readProcedurePaths(input.pathname);
  if (paths.length === 0) return;

  const attempts = new Map();
  const actor = getCommandAuditActor(input.context);
  for (const [batchIndex, path] of paths.entries()) {
    const procedure = input.router._def.procedures[path];
    const contract =
      procedure?._def.meta && typeof procedure._def.meta === "object"
        ? (procedure._def.meta as { commandAudit?: CommandAuditContract }).commandAudit
        : undefined;
    if (procedure?._def.type !== "mutation" || !contract) continue;

    const attempt = await beginCommandAudit({
      path,
      requestId: input.context.requestId,
      actor,
      contract,
      rawInput: undefined,
      requestHeaders: input.context.requestHeaders
    });
    attempts.set(`${path}:${batchIndex}`, { attempt, actor, contract, consumed: false });
  }

  if (attempts.size > 0) input.context.commandAuditAttempts = attempts;
}

export async function finalizeUnconsumedTransportCommandAudits(context: Context): Promise<void> {
  for (const prepared of context.commandAuditAttempts?.values() ?? []) {
    if (prepared.consumed) continue;

    try {
      await finishCommandAudit({
        attempt: prepared.attempt,
        requestId: context.requestId,
        actor: prepared.actor,
        contract: prepared.contract,
        outcome: "validation_failed"
      });
    } catch (error) {
      console.error("[command-audit] failed to persist transport validation outcome", {
        attemptId: prepared.attempt.id,
        requestId: context.requestId,
        error: error instanceof Error ? error.message : String(error)
      });
    }
  }
}
