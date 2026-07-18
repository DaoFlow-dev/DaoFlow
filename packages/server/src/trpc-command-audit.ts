import type { ApiTokenScope } from "@daoflow/shared";
import { getSessionAuthContext, type Context } from "./context";
import {
  beginCommandAudit,
  classifyCommandAuditError,
  finishCommandAudit,
  summarizeCommandInput,
  successOutcomeForCommand,
  type CommandAuditActor,
  type CommandAuditContract
} from "./db/services/command-audit";
import { t } from "./trpc-core";

export function getCommandAuditActor(ctx: Context): CommandAuditActor {
  const authContext = ctx.auth ?? getSessionAuthContext(ctx.session);
  if (!authContext) {
    return {
      type: "anonymous",
      id: "anonymous",
      email: null,
      role: null,
      linkedUserId: null
    };
  }

  return {
    type:
      authContext.method === "session"
        ? "user"
        : authContext.principal.type === "agent"
          ? "agent"
          : authContext.principal.type === "service"
            ? "service"
            : "token",
    id: authContext.principal.id,
    email: authContext.principal.email,
    role: authContext.role,
    linkedUserId: authContext.principal.linkedUserId
  };
}

export const commandAuditMiddleware = t.middleware(
  async ({ batchIndex, ctx, getRawInput, meta, next, path, type }) => {
    if (type !== "mutation" || !meta?.commandAudit) {
      return next();
    }

    const prepared = ctx.commandAuditAttempts?.get(`${path}:${batchIndex}`);
    const rawInput = await getRawInput();
    const actor = prepared?.actor ?? getCommandAuditActor(ctx);
    const safeInput = summarizeCommandInput(rawInput, path);
    const attempt = prepared
      ? {
          ...prepared.attempt,
          targetResource: safeInput.targetResource,
          inputSummary: JSON.stringify(safeInput.summary)
        }
      : await beginCommandAudit({
          path,
          requestId: ctx.requestId,
          actor,
          contract: meta.commandAudit,
          rawInput,
          requestHeaders: ctx.requestHeaders
        });
    if (prepared) prepared.consumed = true;
    const result = await next({ ctx: { commandAuditAttemptId: attempt.id } });

    try {
      if (result.ok) {
        await finishCommandAudit({
          attempt,
          requestId: ctx.requestId,
          actor,
          contract: meta.commandAudit,
          outcome: successOutcomeForCommand(path),
          result: result.data
        });
      } else {
        await finishCommandAudit({
          attempt,
          requestId: ctx.requestId,
          actor,
          contract: meta.commandAudit,
          outcome: classifyCommandAuditError(result.error),
          error: result.error
        });
      }
    } catch (error) {
      // External state may already have changed. Keep the real response and
      // leave the durable intent for reconciliation instead of causing a retry.
      console.error("[command-audit] failed to persist terminal outcome", {
        attemptId: attempt.id,
        requestId: ctx.requestId,
        path,
        error: error instanceof Error ? error.message : String(error)
      });
    }

    return result;
  }
);

export function commandAuditContract(
  permissionScope: string,
  requiredScopes: readonly ApiTokenScope[]
): CommandAuditContract {
  return {
    version: 1,
    permissionScope,
    requiredScopes,
    approvalRequired: false,
    idempotencyExpected: true
  };
}
