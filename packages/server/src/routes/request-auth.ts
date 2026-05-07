import { hasAllScopes, type ApiTokenScope, type AppRole } from "@daoflow/shared";
import { resolveBearerTokenAuthResult } from "../api-token-auth";
import { auth, type AuthSession } from "../auth";
import { getSessionAuthContext, type RequestAuthContext } from "../context";
import { ensureControlPlaneReady } from "../db/services/seed";
import {
  buildAccessLogAttribution,
  rememberRequestAccessLogAttribution
} from "../request-access-log-context";

export interface AuthorizedRequestActor {
  session: NonNullable<AuthSession>;
  auth: RequestAuthContext;
  role: AppRole;
}

export type RequestAuthorizationResult =
  | {
      ok: true;
      actor: AuthorizedRequestActor;
    }
  | {
      ok: false;
      status: 401 | 403;
      body: Record<string, unknown>;
    };

function authRequiredResult(): RequestAuthorizationResult {
  return {
    ok: false,
    status: 401,
    body: {
      ok: false,
      error: "Valid authentication required. Provide a session cookie or Bearer token.",
      code: "AUTH_REQUIRED"
    }
  };
}

function getClientIp(headers: Headers): string {
  return (
    headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
    headers.get("x-real-ip") ||
    headers.get("cf-connecting-ip") ||
    "127.0.0.1"
  );
}

export async function authorizeRequest(input: {
  headers: Headers;
  requiredScopes: readonly ApiTokenScope[];
  sourceIp?: string | null;
  userAgent?: string | null;
}): Promise<RequestAuthorizationResult> {
  const session = await auth.api.getSession({ headers: input.headers });
  const tokenAuthResult = session
    ? ({ status: "absent" } as const)
    : await resolveBearerTokenAuthResult(input.headers.get("authorization"), {
        sourceIp: input.sourceIp ?? getClientIp(input.headers),
        userAgent: input.userAgent ?? input.headers.get("user-agent")
      });
  const tokenAuth = tokenAuthResult.status === "ok" ? tokenAuthResult.auth : null;
  const authContext = tokenAuth
    ? ({
        method: "api-token",
        role: tokenAuth.role,
        capabilities: tokenAuth.effectiveCapabilities,
        principal: tokenAuth.principal,
        token: {
          ...tokenAuth.token,
          scopes: tokenAuth.presentedScopes
        }
      } satisfies RequestAuthContext)
    : getSessionAuthContext(session);

  if (tokenAuthResult.status === "rejected") {
    rememberRequestAccessLogAttribution(
      input.headers,
      buildAccessLogAttribution({
        auth: null,
        requiredScopes: input.requiredScopes,
        errorCategory: tokenAuthResult.failure.code,
        token: tokenAuthResult.failure.token ?? null
      })
    );
    return {
      ok: false,
      status: 401,
      body: {
        ok: false,
        error: tokenAuthResult.failure.error,
        code: tokenAuthResult.failure.code
      }
    };
  }

  if (!authContext || !(tokenAuth?.session ?? session)) {
    rememberRequestAccessLogAttribution(
      input.headers,
      buildAccessLogAttribution({
        auth: null,
        requiredScopes: input.requiredScopes,
        errorCategory: "AUTH_REQUIRED"
      })
    );
    return authRequiredResult();
  }

  await ensureControlPlaneReady();

  if (!hasAllScopes(authContext.capabilities, input.requiredScopes)) {
    rememberRequestAccessLogAttribution(
      input.headers,
      buildAccessLogAttribution({
        auth: authContext,
        requiredScopes: input.requiredScopes,
        errorCategory: "SCOPE_DENIED",
        grantedScopes: authContext.capabilities
      })
    );
    return {
      ok: false,
      status: 403,
      body: {
        ok: false,
        error: `Missing required scope(s): ${input.requiredScopes.join(", ")}`,
        code: "SCOPE_DENIED",
        requiredScopes: input.requiredScopes
      }
    };
  }

  rememberRequestAccessLogAttribution(
    input.headers,
    buildAccessLogAttribution({
      auth: authContext,
      requiredScopes: input.requiredScopes,
      grantedScopes: authContext.capabilities
    })
  );

  return {
    ok: true,
    actor: {
      session: (tokenAuth?.session ?? session)!,
      auth: authContext,
      role: authContext.role
    }
  };
}
