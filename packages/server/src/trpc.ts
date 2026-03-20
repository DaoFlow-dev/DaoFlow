import { initTRPC, TRPCError } from "@trpc/server";
import { canAssumeAnyRole, hasAllScopes, type ApiTokenScope, type AppRole } from "@daoflow/shared";
import { getSessionAuthContext, type Context } from "./context";
import { ensureControlPlaneReady } from "./db/services/seed";

export const t = initTRPC.context<Context>().create({
  errorFormatter({ shape, error }) {
    const cause =
      error.cause && typeof error.cause === "object"
        ? (error.cause as unknown as Record<string, unknown>)
        : null;

    return cause
      ? {
          ...shape,
          data: {
            ...shape.data,
            cause
          }
        }
      : shape;
  }
});

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

// ── Role-gated ───────────────────────────────────────────────
export const roleProcedure = (allowedRoles: readonly AppRole[]) =>
  protectedProcedure.use(({ ctx, next }) => {
    const role = ctx.auth.role;

    if (!canAssumeAnyRole(role, allowedRoles)) {
      throw new TRPCError({
        code: "FORBIDDEN",
        message: "Your role is not allowed to access this procedure."
      });
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
export const adminProcedure = roleProcedure(["owner", "admin"]);
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
const ALL_INCL_AGENT = ["owner", "admin", "operator", "developer", "agent"] as const;
const ALL_READERS = ["owner", "admin", "operator", "developer", "viewer", "agent"] as const;

export const serverWriteProcedure = scopedProcedure(ADMIN_ONLY, ["server:write"]);
export const deployReadProcedure = scopedProcedure(ALL_READERS, ["deploy:read"]);
export const backupReadProcedure = scopedProcedure(ALL_READERS, ["backup:read"]);
export const deployStartProcedure = scopedProcedure(ALL_WRITE, ["deploy:start"]);
export const deployRollbackProcedure = scopedProcedure(ALL_WRITE, ["deploy:rollback"]);
export const deployCancelProcedure = scopedProcedure(ALL_WRITE, ["deploy:cancel"]);
export const envWriteProcedure = scopedProcedure(ALL_WRITE, ["env:write"]);
export const secretsReadProcedure = scopedProcedure(ALL_INCL_AGENT, ["secrets:read"]);
export const serviceUpdateProcedure = scopedProcedure(ALL_WRITE, ["service:update"]);
export const backupRunProcedure = scopedProcedure(ALL_OPS, ["backup:run"]);
export const backupRestoreProcedure = scopedProcedure(ALL_OPS, ["backup:restore"]);
export const approvalsCreateProcedure = scopedProcedure(ALL_INCL_AGENT, ["approvals:create"]);
export const approvalsDecideProcedure = scopedProcedure(ALL_OPS, ["approvals:decide"]);
export const tokensManageProcedure = scopedProcedure(ADMIN_ONLY, ["tokens:manage"]);
export const membersManageProcedure = scopedProcedure(ADMIN_ONLY, ["members:manage"]);

// ── Actor context helper (dedup 15+ call sites) ──────────────
export function getActorContext(ctx: {
  session: { user: { id: string; email: string } };
  role: AppRole;
}) {
  return {
    requestedByUserId: ctx.session.user.id,
    requestedByEmail: ctx.session.user.email,
    requestedByRole: ctx.role
  };
}

/** Alias for update mutations where "updated" reads better. */
export function getUpdaterContext(ctx: {
  session: { user: { id: string; email: string } };
  role: AppRole;
}) {
  return {
    updatedByUserId: ctx.session.user.id,
    updatedByEmail: ctx.session.user.email,
    updatedByRole: ctx.role
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
