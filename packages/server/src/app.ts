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
