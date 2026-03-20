import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger } from "hono/logger";
import { secureHeaders } from "hono/secure-headers";
import { trpcServer } from "@hono/trpc-server";
import { DEFAULT_CLIENT_PORT } from "@daoflow/shared";
import { auth } from "./auth";
import { createContext } from "./context";
import { createRequestId } from "./request-id";
import { appRouter } from "./router";
import { imagesRouter } from "./routes/images";
import { webhooksRouter } from "./routes/webhooks";
import { deployContextRouter } from "./routes/deploy-context";
import { cliAuthRouter } from "./routes/cli-auth";
import { serviceObservabilityRouter } from "./routes/service-observability";
import { authorizeRequest } from "./routes/request-auth";
import { ensureInitialOwnerFromEnv } from "./bootstrap-initial-owner";

type Env = {
  Variables: {
    requestId: string;
  };
};

export function createApp() {
  const app = new Hono<Env>();
  const allowedDevOrigin = `http://localhost:${DEFAULT_CLIENT_PORT}`;

  // ── Middleware ─────────────────────────────────────────────
  app.use("*", async (c, next) => {
    const requestId = c.req.header("x-request-id") ?? createRequestId();
    c.set("requestId", requestId);
    c.header("x-request-id", requestId);
    await next();
  });

  app.use("*", secureHeaders());
  app.use(
    "*",
    cors({
      origin:
        process.env.CORS_ORIGIN ?? (process.env.NODE_ENV === "production" ? "" : allowedDevOrigin),
      credentials: true
    })
  );
  app.use("*", logger());

  // ── Auth rate limiting (credential endpoints only) ──────
  const authRateLimitMap = new Map<string, { count: number; reset: number }>();
  const RATE_LIMITED_AUTH_PATHS = [
    "/api/auth/sign-in",
    "/api/auth/sign-up",
    "/api/auth/forgot-password",
    "/api/auth/reset-password"
  ];

  function getClientIp(c: {
    req: { header: (name: string) => string | undefined };
    env: unknown;
  }): string {
    return (
      c.req.header("x-forwarded-for")?.split(",")[0]?.trim() ||
      c.req.header("x-real-ip") ||
      c.req.header("cf-connecting-ip") ||
      // Bun exposes socket address via the server context
      (c.env as Record<string, string> | undefined)?.remoteAddress ||
      "127.0.0.1"
    );
  }

  app.use("/api/auth/*", async (c, next) => {
    const method = c.req.method;
    const path = new URL(c.req.url).pathname;

    // Only rate-limit credential mutations, not session checks
    const isCredentialEndpoint =
      method === "POST" && RATE_LIMITED_AUTH_PATHS.some((p) => path.startsWith(p));

    if (!isCredentialEndpoint) {
      await next();
      return;
    }

    const ip = getClientIp(c);
    const now = Date.now();
    const windowMs = 60_000; // 1 minute
    const maxRequests = 60;

    // Purge expired entries every 100 requests to prevent memory leaks
    if (authRateLimitMap.size > 100) {
      for (const [key, val] of authRateLimitMap) {
        if (val.reset < now) authRateLimitMap.delete(key);
      }
    }

    let entry = authRateLimitMap.get(ip);
    if (!entry || entry.reset < now) {
      entry = { count: 0, reset: now + windowMs };
      authRateLimitMap.set(ip, entry);
    }

    entry.count++;
    c.header("X-RateLimit-Limit", String(maxRequests));
    c.header("X-RateLimit-Remaining", String(Math.max(0, maxRequests - entry.count)));
    c.header("X-RateLimit-Reset", String(Math.ceil(entry.reset / 1000)));

    if (entry.count > maxRequests) {
      return c.json(
        { error: "Too many requests. Please try again later.", code: "RATE_LIMITED" },
        429
      );
    }

    await next();
  });

  // ── Better Auth ───────────────────────────────────────────
  app.use("/api/auth/*", async (_c, next) => {
    await ensureInitialOwnerFromEnv();
    await next();
  });
  app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

  // ── Image push (REST API) ─────────────────────────────────
  app.route("/api/v1/images", imagesRouter);

  // ── Deploy context upload (REST API) ──────────────────────
  app.route("/api/v1/deploy", deployContextRouter);

  // ── CLI device/browser auth ───────────────────────────────
  app.route("/api/v1/cli-auth", cliAuthRouter);
  app.route("/cli/auth", cliAuthRouter);

  // ── Service observability (REST API) ──────────────────────
  app.route("/api/v1", serviceObservabilityRouter);

  // ── Webhooks (GitHub/GitLab) ──────────────────────────────
  app.route("/api/webhooks", webhooksRouter);

  // ── Health ────────────────────────────────────────────────
  app.get("/health", (c) =>
    c.json({
      status: "healthy",
      service: "daoflow-control-plane",
      requestId: c.get("requestId"),
      timestamp: new Date().toISOString()
    })
  );

  // ── SSE Log Streaming (T-15) ──────────────────────────────
  app.get("/api/v1/logs/stream/:deploymentId", async (c) => {
    const authResult = await authorizeRequest({
      headers: c.req.raw.headers,
      requiredScopes: ["logs:read"]
    });
    if (!authResult.ok) {
      return c.json(authResult.body, authResult.status);
    }

    const deploymentId = c.req.param("deploymentId");
    if (!deploymentId) {
      return c.json({ ok: false, error: "Missing deploymentId" }, 400);
    }

    // Dynamic import to avoid circular deps
    const { db } = await import("./db/connection");
    const { deploymentLogs } = await import("./db/schema/deployments");
    const { eq, and, gt } = await import("drizzle-orm");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      start(controller) {
        let lastId = 0;
        let attempts = 0;
        const MAX_ATTEMPTS = 600; // 10 minutes max

        const poll = async () => {
          try {
            const baseCondition = eq(deploymentLogs.deploymentId, deploymentId);
            const condition = lastId
              ? and(baseCondition, gt(deploymentLogs.id, lastId))
              : baseCondition;

            const rows = await db
              .select()
              .from(deploymentLogs)
              .where(condition)
              .orderBy(deploymentLogs.id)
              .limit(100);

            for (const row of rows) {
              const data = JSON.stringify({
                id: row.id,
                level: row.level,
                message: row.message,
                source: row.source,
                timestamp: row.createdAt
              });
              controller.enqueue(encoder.encode(`data: ${data}\n\n`));
              lastId = row.id;
            }

            attempts++;
            if (attempts < MAX_ATTEMPTS) {
              setTimeout(() => void poll(), 1000);
            } else {
              controller.enqueue(encoder.encode(`data: {"done": true}\n\n`));
              controller.close();
            }
          } catch {
            controller.close();
          }
        };

        void poll();
      }
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Request-Id": c.get("requestId")
      }
    });
  });

  // ── tRPC ──────────────────────────────────────────────────
  app.use(
    "/trpc/*",
    trpcServer({
      router: appRouter,
      createContext: (_opts, c) => createContext(c) as unknown as Record<string, unknown>,
      onError({ error, path }) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "tRPC request failed",
            path,
            error: error.message
          })
        );
      }
    })
  );

  // ── Error handler ─────────────────────────────────────────
  app.onError((err, c) => {
    console.error(
      JSON.stringify({
        level: "error",
        message: "Unhandled request error",
        requestId: c.get("requestId"),
        error: err.message
      })
    );
    return c.json({ error: "Internal Server Error" }, 500);
  });

  return app;
}
