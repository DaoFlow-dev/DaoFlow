import type { Context as HonoContext } from "hono";
import {
  normalizeAppRole,
  roleCapabilities,
  type ApiTokenScope,
  type AppRole
} from "@daoflow/shared";
import { auth } from "./auth";
import type { AuthSession } from "./auth";
import { resolveBearerTokenAuthResult, type TokenAuthFailureCode } from "./api-token-auth";

export interface RequestAuthContext {
  method: "session" | "api-token";
  role: AppRole;
  capabilities: readonly ApiTokenScope[];
  principal: {
    id: string;
    email: string;
    name: string | null;
    type: "user" | "service" | "agent";
    linkedUserId: string | null;
  };
  token: {
    id: string;
    name: string;
    prefix: string;
    expiresAt: string | null;
    scopes: readonly ApiTokenScope[];
  } | null;
}

export interface Context {
  requestId: string;
  session: AuthSession;
  auth?: RequestAuthContext | null;
  authFailure?: {
    status: 401;
    body: {
      ok: false;
      error: string;
      code: TokenAuthFailureCode;
    };
  } | null;
}

export function getSessionAuthContext(session: AuthSession): RequestAuthContext | null {
  if (!session) {
    return null;
  }

  const role = normalizeAppRole((session.user as Record<string, unknown>).role);

  return {
    method: "session",
    role,
    capabilities: roleCapabilities[role],
    principal: {
      id: session.user.id,
      email: session.user.email,
      name: session.user.name ?? null,
      type: "user",
      linkedUserId: session.user.id
    },
    token: null
  };
}

export async function createContext(c: HonoContext): Promise<Context> {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers
  });
  const tokenAuthResult = session
    ? ({ status: "absent" } as const)
    : await resolveBearerTokenAuthResult(c.req.header("authorization"));
  const tokenAuth = tokenAuthResult.status === "ok" ? tokenAuthResult.auth : null;

  return {
    requestId:
      (c.get("requestId") as string | undefined) ?? c.req.header("x-request-id") ?? "unknown",
    session: tokenAuth?.session ?? session,
    auth: tokenAuth
      ? {
          method: "api-token",
          role: tokenAuth.role,
          capabilities: tokenAuth.effectiveCapabilities,
          principal: tokenAuth.principal,
          token: {
            ...tokenAuth.token,
            scopes: tokenAuth.presentedScopes
          }
        }
      : getSessionAuthContext(session),
    authFailure:
      tokenAuthResult.status === "rejected"
        ? {
            status: 401,
            body: {
              ok: false,
              error: tokenAuthResult.failure.error,
              code: tokenAuthResult.failure.code
            }
          }
        : null
  };
}
