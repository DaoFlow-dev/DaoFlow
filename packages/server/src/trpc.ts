import { initTRPC, TRPCError } from "@trpc/server";
import {
  canAssumeAnyRole,
  hasAllScopes,
  normalizeAppRole,
  roleCapabilities,
  type ApiTokenScope,
  type AppRole
} from "@daoflow/shared";
import type { Context } from "./context";
import { ensureControlPlaneReady } from "./db/services/seed";

export const t = initTRPC.context<Context>().create();

// ── Protected: requires session ──────────────────────────────
export const protectedProcedure = t.procedure.use(async ({ ctx, next }) => {
  if (!ctx.session) {
    throw new TRPCError({
      code: "UNAUTHORIZED",
      message: "Sign in to access this procedure."
    });
  }

  // Run once per request — the promise caches after first call
  await ensureControlPlaneReady();

  return next({
    ctx: {
      ...ctx,
      session: ctx.session
    }
  });
});

// ── Role-gated ───────────────────────────────────────────────
export const roleProcedure = (allowedRoles: readonly AppRole[]) =>
  protectedProcedure.use(({ ctx, next }) => {
    const role = normalizeAppRole((ctx.session.user as Record<string, unknown>).role);

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
    const capabilities = roleCapabilities[ctx.role];

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

export const serverWriteProcedure = scopedProcedure(ADMIN_ONLY, ["server:write"]);
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
