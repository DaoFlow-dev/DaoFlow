import { TRPCError } from "@trpc/server";
import { canAssumeAnyRole, hasAllScopes, type ApiTokenScope, type AppRole } from "@daoflow/shared";
import { getSessionAuthContext } from "./context";
import { ensureControlPlaneReady } from "./db/services/seed";
import {
  buildAccessLogAttribution,
  rememberRequestAccessLogAttribution
} from "./request-access-log-context";
import { assertHumanMfaSatisfied } from "./db/services/account-security";
import type { CommandAuditContract } from "./db/services/command-audit";
import { commandAuditContract, commandAuditMiddleware } from "./trpc-command-audit";
import { t } from "./trpc-core";
import { DeploymentQueueFullError } from "./db/services/deployment-capacity";

export { t } from "./trpc-core";
export type { ProcedureMeta } from "./trpc-core";

function auditedProcedure(
  procedure: ReturnType<typeof roleProcedure>,
  contract: CommandAuditContract
) {
  return t.procedure.meta({ commandAudit: contract }).use(commandAuditMiddleware).concat(procedure);
}

// ── Protected: requires session ──────────────────────────────
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  const authContext = ctx.auth ?? getSessionAuthContext(ctx.session);

  if (!ctx.session || !authContext) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: ctx.authFailure?.body.error ?? "Sign in to access this procedure.",
      cause: ctx.authFailure?.body
    });
  }

  // Run once per request — the promise caches after first call
  await ensureControlPlaneReady();

  return next({
    ctx: {
      ...ctx,
      session: ctx.session,
      auth: authContext
    }
  });
});

export const userWriteProcedure = t.procedure
  .meta({ commandAudit: commandAuditContract("authenticated", []) })
  .use(commandAuditMiddleware)
  .concat(protectedProcedure);

// ── Role-gated ───────────────────────────────────────────────
export const roleProcedure = (allowedRoles: readonly AppRole[]) =>
  protectedProcedure.use(async ({ ctx, next }) => {
    const role = ctx.auth.role;

    if (!canAssumeAnyRole(role, allowedRoles)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your role is not allowed to access this procedure."
      });
    }

    if (ctx.auth.method === "session") {
      const mfaBlocked = await assertHumanMfaSatisfied({
        userId: ctx.session.user.id,
        role,
        twoFactorEnabled: Boolean((ctx.session.user as Record<string, unknown>).twoFactorEnabled),
        sessionCreatedAt: ctx.session.session.createdAt
      });

      if (mfaBlocked) {
        throw new TRPCError({
          code: "PRECONDITION_FAILED",
          message: mfaBlocked.message,
          cause: {
            ok: false,
            code: mfaBlocked.code,
            requirement: mfaBlocked.requirement
          }
        });
      }
    }

    return next({
      ctx: {
        ...ctx,
        role
      }
    });
  });

// ── Scope-gated (role + token scopes) ────────────────────────
export const scopedProcedure = (
  allowedRoles: readonly AppRole[],
  requiredScopes: readonly ApiTokenScope[]
) =>
  roleProcedure(allowedRoles).use(({ ctx, next }) => {
    const capabilities = ctx.auth.capabilities;

    if (!hasAllScopes(capabilities, requiredScopes)) {
      if (ctx.requestHeaders) {
        rememberRequestAccessLogAttribution(
          ctx.requestHeaders,
          buildAccessLogAttribution({
            auth: ctx.auth,
            requiredScopes,
            grantedScopes: capabilities,
            errorCategory: "SCOPE_DENIED"
          })
        );
      }
      throw new TRPCError({
        code: "FORBIDDEN",
        message: `Missing required scope(s): ${requiredScopes.join(", ")}`,
        cause: {
          ok: false,
          code: "SCOPE_DENIED",
          requiredScopes,
          grantedScopes: capabilities
        }
      });
    }

    return next({ ctx });
  });

// ── Convenience role shortcuts ───────────────────────────────
export const adminProcedure = auditedProcedure(
  roleProcedure(["owner", "admin"]),
  commandAuditContract("role:owner,admin", [])
);
export const deployProcedure = roleProcedure(["owner", "admin", "operator", "developer"]);
export const executionProcedure = roleProcedure(["owner", "admin", "operator"]);
export const planningProcedure = roleProcedure([
  "owner",
  "admin",
  "operator",
  "developer",
  "agent"
]);

// ── Scoped procedure shortcuts (role + scope enforcement) ────
// These enforce AGENTS.md §11 — agents need both role AND scope.
const ALL_WRITE = ["owner", "admin", "operator", "developer"] as const;
const ALL_OPS = ["owner", "admin", "operator"] as const;
const ADMIN_ONLY = ["owner", "admin"] as const;
const OWNER_ONLY = ["owner"] as const;
const ALL_INCL_AGENT = ["owner", "admin", "operator", "developer", "agent"] as const;
const ALL_READERS = ["owner", "admin", "operator", "developer", "viewer", "agent"] as const;

const auditedScopedProcedure = (
  allowedRoles: readonly AppRole[],
  requiredScopes: readonly ApiTokenScope[]
) =>
  auditedProcedure(
    scopedProcedure(allowedRoles, requiredScopes),
    commandAuditContract(requiredScopes.join(","), requiredScopes)
  );

export const serverWriteProcedure = auditedScopedProcedure(ADMIN_ONLY, ["server:write"]);
export const serverOpsWriteProcedure = auditedScopedProcedure(ALL_OPS, ["server:write"]);
export const serverReadProcedure = auditedScopedProcedure(ALL_READERS, ["server:read"]);
export const terminalOpenProcedure = auditedScopedProcedure(["owner"], ["terminal:open"]);
export const deployReadProcedure = auditedScopedProcedure(ALL_READERS, ["deploy:read"]);
export const serviceReadProcedure = auditedScopedProcedure(ALL_READERS, ["service:read"]);
export const backupReadProcedure = auditedScopedProcedure(ALL_READERS, ["backup:read"]);
export const controlPlaneRecoveryReadProcedure = auditedScopedProcedure(OWNER_ONLY, [
  "backup:read"
]);
export const volumesReadProcedure = auditedScopedProcedure(ALL_READERS, ["volumes:read"]);
export const envReadProcedure = auditedScopedProcedure(ALL_READERS, ["env:read"]);
export const logsReadProcedure = auditedScopedProcedure(ALL_READERS, ["logs:read"]);
export const diagnosticsReadProcedure = auditedScopedProcedure(ALL_READERS, ["diagnostics:read"]);

export const deploymentCapacityErrorMiddleware = t.middleware(async ({ next }) => {
  const result = await next();
  const queueError =
    !result.ok && result.error.cause instanceof DeploymentQueueFullError
      ? result.error.cause
      : null;
  if (queueError) {
    throw new TRPCError({
      code: "CONFLICT",
      message: queueError.message,
      cause: {
        code: queueError.code,
        serverId: queueError.serverId,
        maxQueuedDeployments: queueError.maxQueuedDeployments,
        queuedDeploymentCount: queueError.queuedDeploymentCount
      }
    });
  }
  return result;
});

function withDeploymentCapacityErrors(procedure: ReturnType<typeof auditedScopedProcedure>) {
  return procedure.use(deploymentCapacityErrorMiddleware);
}

export const deployStartProcedure = withDeploymentCapacityErrors(
  auditedScopedProcedure(ALL_WRITE, ["deploy:start"])
);
export const deployRollbackProcedure = withDeploymentCapacityErrors(
  auditedScopedProcedure(ALL_WRITE, ["deploy:rollback"])
);
export const deployCancelProcedure = auditedScopedProcedure(ALL_WRITE, ["deploy:cancel"]);
export const envWriteProcedure = auditedScopedProcedure(ALL_WRITE, ["env:write"]);
export const secretsReadProcedure = auditedScopedProcedure(ALL_INCL_AGENT, ["secrets:read"]);
export const serviceUpdateProcedure = auditedScopedProcedure(ALL_WRITE, ["service:update"]);
export const volumesWriteProcedure = auditedScopedProcedure(ALL_WRITE, ["volumes:write"]);
export const backupRunProcedure = auditedScopedProcedure(ALL_OPS, ["backup:run"]);
export const controlPlaneRecoveryRunProcedure = auditedScopedProcedure(OWNER_ONLY, ["backup:run"]);
export const backupRestoreProcedure = auditedScopedProcedure(ALL_OPS, ["backup:restore"]);
export const approvalsCreateProcedure = auditedScopedProcedure(ALL_INCL_AGENT, [
  "approvals:create"
]);
export const externalRestoreApprovalProcedure = auditedScopedProcedure(ALL_OPS, [
  "approvals:create",
  "backup:restore"
]);
export const approvalsDecideProcedure = auditedScopedProcedure(ALL_OPS, ["approvals:decide"]);
export const tokensManageProcedure = auditedScopedProcedure(ADMIN_ONLY, ["tokens:manage"]);
export const membersManageProcedure = auditedScopedProcedure(ADMIN_ONLY, ["members:manage"]);

// ── Actor context helper (dedup 15+ call sites) ──────────────
export function getActorContext(ctx: {
  session: { user: { id: string; email: string } };
  role: AppRole;
  commandAuditAttemptId?: string;
}) {
  return {
    requestedByUserId: ctx.session.user.id,
    requestedByEmail: ctx.session.user.email,
    requestedByRole: ctx.role,
    commandAuditAttemptId: ctx.commandAuditAttemptId
  };
}

/** Alias for update mutations where "updated" reads better. */
export function getUpdaterContext(ctx: {
  session: { user: { id: string; email: string } };
  role: AppRole;
  commandAuditAttemptId?: string;
}) {
  return {
    updatedByUserId: ctx.session.user.id,
    updatedByEmail: ctx.session.user.email,
    updatedByRole: ctx.role,
    commandAuditAttemptId: ctx.commandAuditAttemptId
  };
}

/** Throw a TRPCError for common domain operation result patterns. */
export function throwOnOperationError(
  result: { status: string; currentStatus?: string },
  resourceLabel: string
): void {
  if (result.status === "not-found") {
    throw new TRPCError({
      code: "NOT_FOUND",
      message: `${resourceLabel} not found.`
    });
  }

  if (result.status === "invalid-state") {
    throw new TRPCError({
      code: "CONFLICT",
      message: `${resourceLabel} is already ${result.currentStatus}.`
    });
  }

  if (result.status === "self-approval") {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: `${resourceLabel} must be decided by a different principal.`
    });
  }
}

/** Helper for delete/cancel mutations that carry userId, email, and role. */
export function getDeleteContext(ctx: {
  session: { user: { id: string; email: string; role?: string | null } };
}) {
  return {
    userId: ctx.session.user.id,
    email: ctx.session.user.email,
    role: (ctx.session.user.role ?? "viewer") as AppRole
  };
}

/**
 * Map a deploy/rollback result status to the appropriate TRPCError.
 * Centralises the repeated if-chain in triggerDeploy / executeRollback.
 */
export function throwOnDeployResultError(result: {
  status: string;
  entity?: string;
  message?: string;
  retention?: number;
}): void {
  const map: Record<string, { code: TRPCError["code"]; message: string }> = {
    not_found: {
      code: "NOT_FOUND",
      message: `${result.entity ?? "Resource"} not found.`
    },
    no_server: {
      code: "BAD_REQUEST",
      message: "No target server configured for this service or environment."
    },
    create_failed: {
      code: "INTERNAL_SERVER_ERROR",
      message: "Failed to create deployment record."
    },
    invalid_source: {
      code: "BAD_REQUEST",
      message: result.message ?? "Invalid deployment source."
    },
    invalid_preview: {
      code: "BAD_REQUEST",
      message: result.message ?? "Invalid preview deployment request."
    },
    provider_unavailable: {
      code: "PRECONDITION_FAILED",
      message: result.message ?? "Provider unavailable."
    },
    invalid_target: {
      code: "BAD_REQUEST",
      message: "Target deployment is not a successful deployment."
    },
    outside_retention: {
      code: "BAD_REQUEST",
      message: `Target deployment is outside the retention window (${result.retention} versions).`
    }
  };

  const entry = map[result.status];
  if (entry) {
    throw new TRPCError({ code: entry.code, message: entry.message });
  }
}
