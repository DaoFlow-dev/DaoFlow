import { createMiddleware } from "hono/factory";
import { resolveBearerTokenAuthResult } from "./api-token-auth";
import { auth } from "./auth";
import { getSessionAuthContext, type RequestAuthContext } from "./context";
import { getClientIpFromHeaders, recordRequestAccessLog } from "./db/services/request-access-logs";

type AccessLogEnv = {
  Variables: {
    requestId: string;
  };
};

async function resolveAccessActor(headers: Headers, sourceIp: string) {
  const cookieHeader = headers.get("cookie") ?? "";
  const authorizationHeader = headers.get("authorization");
  const hasSessionCookie = cookieHeader.includes("better-auth.session_token=");
  const hasBearerToken = authorizationHeader?.startsWith("Bearer ") ?? false;

  if (!hasSessionCookie && !hasBearerToken) {
    return { auth: null, errorCategory: null };
  }

  const session = await auth.api.getSession({ headers });
  const sessionAuth = getSessionAuthContext(session);

  if (sessionAuth) {
    return { auth: sessionAuth, errorCategory: null };
  }

  const tokenResult = await resolveBearerTokenAuthResult(authorizationHeader, {
    sourceIp,
    recordUsage: false
  });

  if (tokenResult.status === "ok") {
    const tokenAuth = tokenResult.auth;
    return {
      auth: {
        method: "api-token",
        role: tokenAuth.role,
        capabilities: tokenAuth.effectiveCapabilities,
        principal: tokenAuth.principal,
        token: {
          ...tokenAuth.token,
          scopes: tokenAuth.presentedScopes
        }
      } satisfies RequestAuthContext,
      errorCategory: null
    };
  }

  return {
    auth: null,
    errorCategory: tokenResult.status === "rejected" ? tokenResult.failure.code : null
  };
}

export const requestAccessLogMiddleware = createMiddleware<AccessLogEnv>(async (c, next) => {
  const startedAt = performance.now();
  let thrownError: unknown = null;

  try {
    await next();
  } catch (error) {
    thrownError = error;
    throw error;
  } finally {
    const sourceIp = getClientIpFromHeaders(c.req.raw.headers);
    const actor = await resolveAccessActor(c.req.raw.headers, sourceIp).catch(() => ({
      auth: null,
      errorCategory: null
    }));
    const auth = actor.auth;
    const statusCode = thrownError ? 500 : c.res.status;

    await recordRequestAccessLog({
      requestId: c.get("requestId"),
      method: c.req.method,
      url: c.req.url,
      statusCode,
      durationMs: performance.now() - startedAt,
      authMethod: auth?.method ?? null,
      actorType: auth?.principal.type ?? null,
      actorId: auth?.principal.id ?? null,
      actorEmail: auth?.principal.email ?? null,
      actorRole: auth?.role ?? null,
      tokenId: auth?.token?.id ?? null,
      tokenPrefix: auth?.token?.prefix ?? null,
      sourceIp,
      userAgent: c.req.header("user-agent") ?? null,
      errorCategory: actor.errorCategory
    }).catch((error) => {
      console.warn("Failed to record request access log", error);
    });
  }
});
