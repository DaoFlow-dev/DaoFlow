import { hasAllScopes, type ApiTokenScope, type AppRole } from "@daoflow/shared";
import { resolveBearerTokenAuth } from "../api-token-auth";
import { auth, type AuthSession } from "../auth";
import { getSessionAuthContext, type RequestAuthContext } from "../context";
import { ensureControlPlaneReady } from "../db/services/seed";

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

export async function authorizeRequest(input: {
  headers: Headers;
  requiredScopes: readonly ApiTokenScope[];
}): Promise<RequestAuthorizationResult> {
  const session = await auth.api.getSession({ headers: input.headers });
  const tokenAuth = session
    ? null
    : await resolveBearerTokenAuth(input.headers.get("authorization"));
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

  if (!authContext || !(tokenAuth?.session ?? session)) {
    return authRequiredResult();
  }

  await ensureControlPlaneReady();

  if (!hasAllScopes(authContext.capabilities, input.requiredScopes)) {
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

  return {
    ok: true,
    actor: {
      session: (tokenAuth?.session ?? session)!,
      auth: authContext,
      role: authContext.role
    }
  };
}
