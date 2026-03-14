import { initTRPC, TRPCError } from "@trpc/server";
import { canAssumeAnyRole, normalizeAppRole, type AppRole } from "@daoflow/shared";
import type { Context } from "./context";
import { ensureControlPlaneReady } from "./db/services/seed";

export const t = initTRPC.context<Context>().create();

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
