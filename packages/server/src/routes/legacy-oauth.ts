import { Hono } from "hono";

export const LEGACY_OAUTH_TOKEN_PATH = "/api/v1/oauth/token";

function buildCallerMetadata(request: Request) {
  return {
    userAgent: request.headers.get("user-agent") ?? "unknown",
    origin: request.headers.get("origin") ?? null,
    referer: request.headers.get("referer") ?? null,
    forwardedFor: request.headers.get("x-forwarded-for") ?? null,
    realIp: request.headers.get("x-real-ip") ?? null
  };
}

function buildCallerFingerprint(request: Request) {
  const metadata = buildCallerMetadata(request);
  return JSON.stringify(metadata);
}

export function createLegacyOauthRouter(input?: { logWarning?: (message: string) => void }) {
  const router = new Hono();
  const logWarning = input?.logWarning ?? console.warn;
  const seenCallers = new Set<string>();

  router.post("/token", (c) => {
    const fingerprint = buildCallerFingerprint(c.req.raw);

    if (!seenCallers.has(fingerprint)) {
      seenCallers.add(fingerprint);
      logWarning(
        JSON.stringify({
          level: "warn",
          message: "Deprecated OAuth token endpoint called",
          path: LEGACY_OAUTH_TOKEN_PATH,
          rootCause:
            "Current DaoFlow source and checked-in client assets do not call this path. A stale external caller is still probing the legacy endpoint.",
          caller: buildCallerMetadata(c.req.raw)
        })
      );
    }

    return c.json(
      {
        ok: false,
        error:
          "Legacy OAuth token endpoint removed. Update the caller to use the GitLab callback flow via /settings/git/callback.",
        code: "LEGACY_OAUTH_ENDPOINT_REMOVED"
      },
      410
    );
  });

  return router;
}

export const legacyOauthRouter = createLegacyOauthRouter();
