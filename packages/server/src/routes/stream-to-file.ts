/**
 * stream-to-file.ts — Shared helper for streaming request bodies to disk.
 *
 * Used by images.ts and deploy-context.ts to receive large binary uploads
 * (Docker tarballs, build contexts) without loading them entirely into memory.
 */

import { createWriteStream, mkdirSync, existsSync } from "node:fs";
import { once } from "node:events";

export const DEFAULT_STREAM_HEARTBEAT_INTERVAL_MS = 30_000;

export interface StreamBodyToFileOptions {
  heartbeat?: () => Promise<void>;
  heartbeatIntervalMs?: number;
}

function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error));
}

/**
 * Stream a ReadableStream body to a file on disk.
 *
 * @param body - The request body ReadableStream
 * @param destPath - Absolute path where the file should be written
 * @param options - Optional heartbeat used to keep request-scoped work alive
 * @returns Promise that resolves when the file is fully written
 */
export async function streamBodyToFile(
  body: ReadableStream,
  destPath: string,
  options: StreamBodyToFileOptions = {}
): Promise<void> {
  const dir = destPath.substring(0, destPath.lastIndexOf("/"));
  if (dir && !existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }

  const heartbeatIntervalMs = options.heartbeatIntervalMs ?? DEFAULT_STREAM_HEARTBEAT_INTERVAL_MS;
  if (!Number.isFinite(heartbeatIntervalMs) || heartbeatIntervalMs <= 0) {
    throw new Error("Stream heartbeat interval must be a positive number.");
  }

  const writeStream = createWriteStream(destPath);
  const reader = body.getReader();
  let streamFailure: Error | null = null;
  let cancelPromise: Promise<void> | null = null;
  let stopped = false;
  let heartbeatTimer: ReturnType<typeof setTimeout> | undefined;
  let resolveHeartbeatWait: (() => void) | undefined;

  let rejectHeartbeatFailure: ((reason: Error) => void) | undefined;
  const heartbeatFailure = options.heartbeat
    ? new Promise<never>((_, reject) => {
        rejectHeartbeatFailure = reject;
      })
    : null;

  const fail = (error: unknown) => {
    if (streamFailure) {
      return;
    }

    streamFailure = asError(error);
    rejectHeartbeatFailure?.(streamFailure);
    writeStream.destroy(streamFailure);
    cancelPromise ??= reader
      .cancel(streamFailure)
      .then(() => undefined)
      .catch(() => undefined);
  };

  writeStream.on("error", (error) => {
    fail(error);
  });

  const waitForHeartbeat = () =>
    new Promise<void>((resolve) => {
      resolveHeartbeatWait = resolve;
      heartbeatTimer = setTimeout(() => {
        heartbeatTimer = undefined;
        resolveHeartbeatWait = undefined;
        resolve();
      }, heartbeatIntervalMs);
    });

  const heartbeat = async () => {
    if (!options.heartbeat) {
      return;
    }

    while (!stopped) {
      await waitForHeartbeat();
      if (stopped) {
        return;
      }

      try {
        await options.heartbeat();
      } catch (error) {
        if (!stopped) {
          fail(error);
        }
        return;
      }
    }
  };

  const pump = async () => {
    try {
      while (true) {
        const { done, value } = (await reader.read()) as { done: boolean; value?: Uint8Array };
        if (done) {
          break;
        }
        if (streamFailure) {
          throw streamFailure;
        }
        if (value) {
          if (!writeStream.write(value)) {
            await once(writeStream, "drain");
          }
        }
      }

      if (streamFailure) {
        throw streamFailure;
      }

      await new Promise<void>((resolve, reject) => {
        writeStream.once("finish", resolve);
        writeStream.once("error", reject);
        writeStream.end();
      });
    } catch (error) {
      fail(error);
      throw streamFailure ?? asError(error);
    }
  };

  const heartbeatPromise = options.heartbeat ? heartbeat() : Promise.resolve();
  const pumpPromise = pump();

  try {
    await (heartbeatFailure
      ? Promise.race([pumpPromise, heartbeatFailure])
      : Promise.race([pumpPromise]));
    await pumpPromise;
  } catch (error) {
    fail(error);
    throw streamFailure ?? asError(error);
  } finally {
    stopped = true;
    if (heartbeatTimer) {
      clearTimeout(heartbeatTimer);
      heartbeatTimer = undefined;
    }
    resolveHeartbeatWait?.();
    resolveHeartbeatWait = undefined;
    await Promise.allSettled([pumpPromise, heartbeatPromise, cancelPromise ?? Promise.resolve()]);
  }
}
