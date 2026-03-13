import path from "node:path";
import { fileURLToPath } from "node:url";
import { serveStatic } from "hono/bun";
import { DEFAULT_SERVER_PORT } from "@daoflow/shared";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const isProduction = process.env.NODE_ENV === "production";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function start() {
  const app = createApp();

  if (isProduction) {
    const clientDistDir = path.resolve(__dirname, "../../client/dist");

    app.use("/*", serveStatic({ root: clientDistDir }));
    app.get("*", async (_c) => {
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

  const shutdown = (signal: string) => {
    console.log(`Received ${signal}; shutting down DaoFlow control plane.`);
    void server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void start();
