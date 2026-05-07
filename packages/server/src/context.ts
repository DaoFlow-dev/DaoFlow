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
import {
  buildAccessLogAttribution,
  rememberRequestAccessLogAttribution
} from "./request-access-log-context";

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
  requestHeaders?: Headers;
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

function getClientIp(c: HonoContext): string {
  return (
    c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
    c.req.header("x-real-ip") ||
    c.req.header("cf-connecting-ip") ||
    "127.0.0.1"
  );
}

export async function createContext(c: HonoContext): Promise<Context> {
  const session = await auth.api.getSession({
    headers: c.req.raw.headers
  });
  const tokenAuthResult = session
    ? ({ status: "absent" } as const)
    : await resolveBearerTokenAuthResult(c.req.header("authorization"), {
        sourceIp: getClientIp(c),
        userAgent: c.req.header("user-agent") ?? null
      });
  const tokenAuth = tokenAuthResult.status === "ok" ? tokenAuthResult.auth : null;
  const authContext = tokenAuth
    ? {
        method: "api-token" as const,
        role: tokenAuth.role,
        capabilities: tokenAuth.effectiveCapabilities,
        principal: tokenAuth.principal,
        token: {
          ...tokenAuth.token,
          scopes: tokenAuth.presentedScopes
        }
      }
    : getSessionAuthContext(session);

  rememberRequestAccessLogAttribution(
    c.req.raw.headers,
    buildAccessLogAttribution({
      auth: authContext,
      errorCategory: tokenAuthResult.status === "rejected" ? tokenAuthResult.failure.code : null,
      token: tokenAuthResult.status === "rejected" ? (tokenAuthResult.failure.token ?? null) : null,
      grantedScopes: authContext?.capabilities ?? []
    })
  );

  return {
    requestId:
      (c.get("requestId") as string | undefined) ?? c.req.header("x-request-id") ?? "unknown",
    requestHeaders: c.req.raw.headers,
    session: tokenAuth?.session ?? session,
    auth: authContext,
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
