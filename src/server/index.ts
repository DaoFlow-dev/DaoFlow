import path from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";
import { DEFAULT_SERVER_PORT } from "../shared/config";
import { createApp } from "./app";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const isProduction = process.env.NODE_ENV === "production";
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

function start() {
  const app = createApp();

  if (isProduction) {
    const clientDistDir = path.resolve(__dirname, "../client");

    app.use(express.static(clientDistDir));
    app.get(/^(?!\/trpc|\/health|\/api\/auth).*/, (_req, res) => {
      res.sendFile(path.join(clientDistDir, "index.html"));
    });
  }

  const server = app.listen(port, () => {
    console.log(`DaoFlow control plane listening on http://localhost:${port}`);
  });

  const shutdown = (signal: NodeJS.Signals) => {
    console.log(`Received ${signal}; shutting down DaoFlow control plane.`);
    server.close((error) => {
      if (error) {
        console.error("Failed to close server cleanly", error);
        process.exit(1);
      }

      process.exit(0);
    });
  };

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
}

void start();
