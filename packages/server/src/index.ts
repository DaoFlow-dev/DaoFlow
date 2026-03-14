import path from "node:path";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { serveStatic } from "hono/bun";
import { DEFAULT_SERVER_PORT } from "@daoflow/shared";
import { createApp } from "./app";
import { startWorker, stopWorker } from "./worker";

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

// ── Server bootstrap ──────────────────────────────────────────
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

// Keep the server reference at module scope so Bun's GC doesn't collect it
const server = Bun.serve({
  port,
  fetch: app.fetch
});

console.log(`DaoFlow control plane listening on http://localhost:${server.port}`);

// Start the execution worker when Docker is available
if (shouldStartWorker()) {
  startWorker();
}

// ── Graceful shutdown ─────────────────────────────────────────
const shutdown = async (signal: string) => {
  console.log(`Received ${signal}; shutting down DaoFlow control plane.`);
  stopWorker();
  void server.stop();
  const { pool } = await import("./db/connection");
  await pool.end();
  process.exit(0);
};

process.on("SIGINT", () => void shutdown("SIGINT"));
process.on("SIGTERM", () => void shutdown("SIGTERM"));

// Log unhandled errors for CI visibility
process.on("unhandledRejection", (reason) => {
  console.error("[warn] Unhandled rejection:", reason);
});
