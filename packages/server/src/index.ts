import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serveStatic } from "hono/bun";
import { DEFAULT_SERVER_PORT } from "@daoflow/shared";
import { createApp } from "./app";
import { startWorker, stopWorker } from "./worker";
import { startTemporalWorker, stopTemporalWorker, closeTemporalClient } from "./worker";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const isProduction = process.env.NODE_ENV === "production";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function shouldStartWorker(): boolean {
  if (process.env.DISABLE_WORKER === "true" || process.env.CI === "true") {
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

function useTemporalWorker(): boolean {
  return !!process.env.TEMPORAL_ADDRESS;
}

function start() {
  const app = createApp();

  if (isProduction) {
    const clientDistDir = path.resolve(__dirname, "../../client/dist");

    app.use("/*", serveStatic({ root: clientDistDir }));
    app.get("*", (_c) => {
      const indexPath = path.join(clientDistDir, "index.html");
      const file = Bun.file(indexPath);
      return new Response(file, {
        headers: { "content-type": "text/html; charset=utf-8" }
      });
    });
  }

  const server = Bun.serve({
    port,
    fetch: app.fetch
  });

  console.log(`DaoFlow control plane listening on http://localhost:${server.port}`);

  // Start the execution worker when Docker is available
  if (shouldStartWorker()) {
    if (useTemporalWorker()) {
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

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}; shutting down DaoFlow control plane.`);
    if (useTemporalWorker()) {
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
