import "./startup-encryption-config";

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
  startDevelopmentTaskWorker,
  stopDevelopmentTaskWorker,
  startDevelopmentTaskWatchdogMonitor,
  stopDevelopmentTaskWatchdogMonitor,
  startApprovalActionDispatchMonitor,
  stopApprovalActionDispatchMonitor,
  startServerMetricsMonitor,
  stopServerMetricsMonitor,
  setServerMetricTransitionHandler,
  startProviderFeedbackMonitor,
  stopProviderFeedbackMonitor,
  startTemporalWorker,
  stopTemporalWorker,
  closeTemporalClient
} from "./worker";
import {
  startServerReadinessMonitor,
  stopServerReadinessMonitor
} from "./worker/server-readiness-monitor";
import {
  startDeploymentWatchdogMonitor,
  stopDeploymentWatchdogMonitor
} from "./worker/deployment-watchdog-monitor";
import {
  startOperationalMaintenanceMonitor,
  stopOperationalMaintenanceMonitor
} from "./worker/operational-maintenance-monitor";
import {
  startServiceScheduleMonitor,
  stopServiceScheduleMonitor
} from "./worker/service-schedule-monitor";
import { ensureInitialOwnerFromEnv } from "./bootstrap-initial-owner";
import { ensureLocalhostServer } from "./bootstrap-localhost-server";
import { runStartupMigrations } from "./startup-migrations";
import { markStartupCheck } from "./startup-readiness";
import { deliverServerMetricTransitionNotification } from "./worker/server-metric-notification-handler";

const port = Number(process.env.PORT ?? DEFAULT_SERVER_PORT);
const isProduction = process.env.NODE_ENV === "production";
const migrationOnly = process.env.DAOFLOW_RUN_MIGRATIONS_ONLY === "true";
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

function shouldStartDevelopmentTaskWorker(): boolean {
  return process.env.ENABLE_DEVELOPMENT_TASK_WORKER === "true";
}

import { isTemporalEnabled } from "./worker/temporal/temporal-config";

async function start() {
  await runStartupMigrations({ isProduction });

  if (migrationOnly) {
    console.log("[migrate] Migration-only mode completed; exiting without starting HTTP server.");
    process.exit(0);
  }

  const app = createApp();
  let legacyWorkerStarted = false;

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

      return app.fetch(req, serverInstance);
    },
    websocket: serviceObservabilityWebSocket
  });

  console.log(`DaoFlow control plane listening on http://localhost:${server.port}`);

  try {
    await ensureInitialOwnerFromEnv();
    markStartupCheck("initial-owner", "ok", "Initial owner bootstrap completed or was skipped.");
  } catch (error) {
    const msg = error instanceof Error ? error.message : String(error);
    const isPasswordError = /password/i.test(msg);
    markStartupCheck("initial-owner", "failed", `Initial owner bootstrap failed: ${msg}`);
    console.error(
      `[auth] Initial owner bootstrap failed: ${msg}` +
        (isPasswordError
          ? "\n       → Ensure DAOFLOW_INITIAL_ADMIN_PASSWORD is at least 8 characters, then recreate the container with: docker compose up -d"
          : "")
    );
  }

  // Auto-register localhost as a deployment target when Docker socket is available
  const workerEnabled = shouldStartWorker();

  if (workerEnabled) {
    try {
      await ensureLocalhostServer();
      markStartupCheck("localhost-server", "ok", "Localhost server bootstrap completed.");
    } catch (error) {
      const msg = error instanceof Error ? error.message : String(error);
      markStartupCheck("localhost-server", "failed", `Localhost server bootstrap failed: ${msg}`);
      console.error(`[bootstrap] Localhost server registration failed: ${msg}`);
    }
  } else {
    markStartupCheck("localhost-server", "skipped", "Localhost server bootstrap skipped.");
  }

  // Start the execution worker when Docker is available
  if (workerEnabled) {
    if (isTemporalEnabled()) {
      console.log("[worker] Temporal mode enabled, starting Temporal worker...");
      void startTemporalWorker({
        onReady: () => {
          markStartupCheck("workers", "ok", "Temporal execution worker connected.");
        }
      }).catch((err) => {
        const msg = err instanceof Error ? err.message : String(err);
        console.error("[worker] Temporal worker failed:", err);
        console.log("[worker] Falling back to legacy polling worker");
        startWorker();
        legacyWorkerStarted = true;
        markStartupCheck(
          "workers",
          "ok",
          `Temporal execution worker failed; using legacy polling worker: ${msg}`
        );
      });
    } else {
      console.log("[worker] No TEMPORAL_ADDRESS set, using legacy polling worker");
      startWorker();
      legacyWorkerStarted = true;
      markStartupCheck("workers", "ok", "Legacy execution worker started.");
    }
  } else {
    markStartupCheck("workers", "skipped", "Execution worker disabled.");
  }

  if (shouldStartDevelopmentTaskWorker()) {
    startDevelopmentTaskWorker();
  }

  startServerReadinessMonitor();
  startDeploymentWatchdogMonitor();
  startDevelopmentTaskWatchdogMonitor();
  startApprovalActionDispatchMonitor();
  startProviderFeedbackMonitor();
  startOperationalMaintenanceMonitor();
  startServiceScheduleMonitor();
  setServerMetricTransitionHandler(async (event) => {
    await deliverServerMetricTransitionNotification(event);
  });
  void startServerMetricsMonitor();

  let shuttingDown = false;
  const shutdown = async (signal: string) => {
    if (shuttingDown) return;
    shuttingDown = true;
    console.log(`Received ${signal}; shutting down DaoFlow control plane.`);
    stopServerReadinessMonitor();
    stopDeploymentWatchdogMonitor();
    stopDevelopmentTaskWatchdogMonitor();
    stopApprovalActionDispatchMonitor();
    stopProviderFeedbackMonitor();
    stopOperationalMaintenanceMonitor();
    stopServiceScheduleMonitor();
    await stopServerMetricsMonitor();
    if (shouldStartDevelopmentTaskWorker()) {
      stopDevelopmentTaskWorker();
    }
    if (isTemporalEnabled()) {
      stopTemporalWorker();
      void closeTemporalClient();
      if (legacyWorkerStarted) {
        stopWorker();
      }
    } else {
      stopWorker();
    }
    await server.stop();
    process.exit(0);
  };

  process.on("SIGINT", () => void shutdown("SIGINT"));
  process.on("SIGTERM", () => void shutdown("SIGTERM"));
}

// Log unhandled rejections for CI visibility (don't exit — let Bun handle it)
process.on("unhandledRejection", (reason) => {
  console.error("[warn] Unhandled rejection:", reason);
});

start().catch((error) => {
  console.error("[startup] DaoFlow control plane failed to start:", error);
  process.exit(1);
});
