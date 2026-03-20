import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serveStatic } from "hono/bun";
import { DEFAULT_SERVER_PORT } from "@daoflow/shared";
import { createApp } from "./app";
import {
  handleServiceObservabilityWebSocketUpgrade,
  serviceObservabilityWebSocket
} from "./service-observability-websocket";
import {
  startWorker,
  stopWorker,
  startTemporalWorker,
  stopTemporalWorker,
  closeTemporalClient
} from "./worker";
import {
  startServerReadinessMonitor,
  stopServerReadinessMonitor
} from "./worker/server-readiness-monitor";
import { ensureInitialOwnerFromEnv } from "./bootstrap-initial-owner";
import { runAutoMigrations } from "./db/auto-migrate";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const isProduction = process.env.NODE_ENV === "production";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function shouldStartWorker(): boolean {
  if (process.env.DISABLE_WORKER === "true") {
    return false;
  }
  if (!existsSync("/var/run/docker.sock")) {
    console.log(
      "[worker] Docker socket not found at /var/run/docker.sock — execution worker disabled"
    );
    return false;
  }
  return true;
}

import { isTemporalEnabled } from "./worker/temporal/temporal-config";

async function start() {
  const app = createApp();

  if (isProduction) {
    const clientDistDir = path.resolve(__dirname, "../../client/dist");
    const indexPath = path.join(clientDistDir, "index.html");

    function fileWithinClientDist(requestPath: string) {
      const relativePath = requestPath.replace(/^\/+/, "");
      const candidate = path.resolve(clientDistDir, relativePath);
      return candidate === clientDistDir || candidate.startsWith(`${clientDistDir}${path.sep}`)
        ? candidate
        : null;
    }

    app.use("/assets/*", serveStatic({ root: clientDistDir }));
    app.use("/manifest.json", serveStatic({ root: clientDistDir }));
    app.use("/favicon.ico", serveStatic({ root: clientDistDir }));
    app.use("/robots.txt", serveStatic({ root: clientDistDir }));
    app.get("*", async (_c) => {
      const filePath = fileWithinClientDist(_c.req.path);
      if (filePath && (await Bun.file(filePath).exists())) {
        return new Response(Bun.file(filePath));
      }

      return new Response(Bun.file(indexPath), {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    });
  }

  const server = Bun.serve({
    port,
    async fetch(req, serverInstance) {
      const upgraded = await handleServiceObservabilityWebSocketUpgrade(req, serverInstance);
      if (upgraded !== null) {
        return upgraded;
      }

      return app.fetch(req, serverInstance as never);
    },
    websocket: serviceObservabilityWebSocket
  });

  console.log(`DaoFlow control plane listening on http://localhost:${server.port}`);

  // Run database migrations before any DB-dependent code
  try {
    await runAutoMigrations();
  } catch (err) {
    console.error(
      "[migrate] Auto-migration failed:",
      err instanceof Error ? err.message : String(err)
    );
    // Continue — the server can still serve health checks
  }

  try {
    await ensureInitialOwnerFromEnv();
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isPasswordError = /password/i.test(msg);
    console.error(
      `[auth] Initial owner bootstrap failed: ${msg}` +
        (isPasswordError
          ? "\n       → Ensure DAOFLOW_INITIAL_ADMIN_PASSWORD is at least 8 characters, then recreate the container with: docker compose up -d"
          : "")
    );
  }

  // Start the execution worker when Docker is available
  if (shouldStartWorker()) {
    if (isTemporalEnabled()) {
      console.log("[worker] Temporal mode enabled, starting Temporal worker...");
      void startTemporalWorker().catch((err) => {
        console.error("[worker] Temporal worker failed:", err);
        console.log("[worker] Falling back to legacy polling worker");
        startWorker();
      });
    } else {
      console.log("[worker] No TEMPORAL_ADDRESS set, using legacy polling worker");
      startWorker();
    }
  }

  startServerReadinessMonitor();

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}; shutting down DaoFlow control plane.`);
    stopServerReadinessMonitor();
    if (isTemporalEnabled()) {
      stopTemporalWorker();
      void closeTemporalClient();
    } else {
      stopWorker();
    }
    void server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

// Log unhandled rejections for CI visibility (don't exit — let Bun handle it)
process.on("unhandledRejection", (reason) => {
  console.error("[warn] Unhandled rejection:", reason);
});

void start();
