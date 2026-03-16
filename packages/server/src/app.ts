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

  // ── Better Auth ───────────────────────────────────────────
  app.all("/api/auth/*", (c) => auth.handler(c.req.raw));

  // ── Image push (REST API) ─────────────────────────────────
  app.route("/api/v1/images", imagesRouter);

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
    const deploymentId = c.req.param("deploymentId");
    if (!deploymentId) {
      return c.json({ ok: false, error: "Missing deploymentId" }, 400);
    }

    // Dynamic import to avoid circular deps
    const { db } = await import("./db/connection");
    const { deploymentLogs } = await import("./db/schema/deployments");
    const { eq } = await import("drizzle-orm");

    const encoder = new TextEncoder();
    const stream = new ReadableStream({
      async start(controller) {
        let lastId = 0;
        let attempts = 0;
        const MAX_ATTEMPTS = 600; // 10 minutes max

        const poll = async () => {
          try {
            const query = lastId
              ? db
                  .select()
                  .from(deploymentLogs)
                  .where(eq(deploymentLogs.deploymentId, deploymentId))
                  .orderBy(deploymentLogs.createdAt)
                  .limit(100)
              : db
                  .select()
                  .from(deploymentLogs)
                  .where(eq(deploymentLogs.deploymentId, deploymentId))
                  .orderBy(deploymentLogs.createdAt)
                  .limit(100);

            const rows = await query;
            for (const row of rows) {
              const data = JSON.stringify({
                id: row.id,
                level: row.level,
                message: row.message,
                source: row.source,
                timestamp: row.createdAt,
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
      },
    });

    return new Response(stream, {
      headers: {
        "Content-Type": "text/event-stream",
        "Cache-Control": "no-cache",
        Connection: "keep-alive",
        "X-Request-Id": c.get("requestId"),
      },
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
