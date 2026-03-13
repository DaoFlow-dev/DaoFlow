import { toNodeHandler } from "better-auth/node";
import cors from "cors";
import express from "express";
import helmet from "helmet";
import morgan from "morgan";
import { createExpressMiddleware } from "@trpc/server/adapters/express";
import { DEFAULT_CLIENT_PORT } from "@daoflow/shared";
import { auth } from "./auth";
import { ensureAuthReady } from "./auth";
import { createContext } from "./context";
import { resolveRequestId } from "./request-id";
import { appRouter } from "./router";
import { imagesRouter } from "./routes/images";

export function createApp() {
  const app = express();
  const allowedDevOrigin = `http://localhost:${DEFAULT_CLIENT_PORT}`;

  app.set("trust proxy", process.env.NODE_ENV === "production");

  morgan.token("request-id", (_req, res) => String(res.getHeader("x-request-id") ?? "unknown"));

  app.use((req, res, next) => {
    const requestId = resolveRequestId(req, res);
    res.locals.requestId = requestId;
    res.setHeader("x-request-id", requestId);
    next();
  });

  app.use(
    helmet({
      contentSecurityPolicy: false
    })
  );
  app.use(
    cors({
      origin: process.env.NODE_ENV === "production" ? false : allowedDevOrigin,
      credentials: true
    })
  );
  app.use(
    morgan(":method :url :status :response-time ms request_id=:request-id", {
      skip: () => process.env.NODE_ENV === "test"
    })
  );

  const authHandler = toNodeHandler(auth);

  app.all("/api/auth/*splat", async (req, res, next) => {
    try {
      await ensureAuthReady();
      await authHandler(req, res);
    } catch (error) {
      next(error);
    }
  });

  // Image push endpoint (before express.json() — accepts raw binary stream)
  app.use("/api/v1/images", imagesRouter);

  app.use(express.json());

  app.get("/health", (req, res) => {
    res.json({
      status: "healthy",
      service: "daoflow-control-plane",
      requestId: resolveRequestId(req, res),
      timestamp: new Date().toISOString()
    });
  });

  app.use(
    "/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext,
      onError({ error, path, ctx }) {
        console.error(
          JSON.stringify({
            level: "error",
            message: "tRPC request failed",
            path,
            requestId: ctx?.requestId ?? "unknown",
            error: error.message
          })
        );
      }
    })
  );

  app.use((error: unknown, req: express.Request, res: express.Response, next: express.NextFunction) => {
    void next;
    console.error(
      JSON.stringify({
        level: "error",
        message: "Unhandled request error",
        requestId: resolveRequestId(req, res),
        error: error instanceof Error ? error.message : String(error)
      })
    );

    if (res.headersSent) {
      return;
    }

    res.status(500).json({
      error: "Internal Server Error"
    });
  });

  return app;
}
