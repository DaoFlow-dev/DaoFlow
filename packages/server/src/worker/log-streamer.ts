/**
 * log-streamer.ts
 *
 * Persists deployment output to the database in real time.
 * Accepts log lines from the docker-executor and batches inserts
 * for performance.
 */

import { db } from "../db/connection";
import { deploymentLogs } from "../db/schema/deployments";
import type { LogLine } from "./docker-executor";

/**
 * Classify a log line's severity based on content patterns.
 */
function classifyLevel(line: LogLine): "info" | "warn" | "error" | "debug" {
  if (line.stream === "stderr") {
    // Not all stderr is error — many tools (docker, git) use stderr for progress
    const lower = line.message.toLowerCase();
    if (
      lower.includes("error") ||
      lower.includes("fatal") ||
      lower.includes("panic") ||
      lower.includes("failed") ||
      lower.includes("denied")
    ) {
      return "error";
    }
    if (lower.includes("warn") || lower.includes("deprecat")) {
      return "warn";
    }
    return "info";
  }

  const lower = line.message.toLowerCase();
  if (lower.includes("error") || lower.includes("fatal")) return "error";
  if (lower.includes("warn")) return "warn";
  if (lower.startsWith("#") || lower.includes("debug")) return "debug";
  return "info";
}

/**
 * Create a log streamer that batches and persists log lines.
 * Returns a callback suitable for docker-executor's OnLog parameter,
 * plus a flush() function to persist any remaining buffered lines.
 */
export function createLogStreamer(deploymentId: string, source: string) {
  const buffer: {
    deploymentId: string;
    level: string;
    message: string;
    source: string;
    metadata: { stream: string };
    createdAt: Date;
  }[] = [];
  let flushTimer: ReturnType<typeof setTimeout> | null = null;

  const BATCH_SIZE = 20;
  const FLUSH_INTERVAL_MS = 1000;

  async function persistBatch() {
    if (buffer.length === 0) return;

    const batch = buffer.splice(0, buffer.length);
    try {
      await db.insert(deploymentLogs).values(batch);
    } catch (err) {
      // Log persistence failure should not crash the worker
      console.error(
        `[log-streamer] Failed to persist ${batch.length} log lines for deployment ${deploymentId}:`,
        err instanceof Error ? err.message : String(err)
      );
    }
  }

  function scheduleFlush() {
    if (flushTimer) return;
    flushTimer = setTimeout(() => {
      flushTimer = null;
      void persistBatch();
    }, FLUSH_INTERVAL_MS);
  }

  /**
   * Accept a log line from docker-executor.
   */
  function onLog(line: LogLine): void {
    buffer.push({
      deploymentId,
      level: classifyLevel(line),
      message: line.message,
      source,
      metadata: { stream: line.stream },
      createdAt: line.timestamp
    });

    if (buffer.length >= BATCH_SIZE) {
      if (flushTimer) {
        clearTimeout(flushTimer);
        flushTimer = null;
      }
      void persistBatch();
    } else {
      scheduleFlush();
    }
  }

  /**
   * Flush any remaining buffered lines. Call this when the deployment
   * step completes.
   */
  async function flush(): Promise<void> {
    if (flushTimer) {
      clearTimeout(flushTimer);
      flushTimer = null;
    }
    await persistBatch();
  }

  return { onLog, flush };
}
