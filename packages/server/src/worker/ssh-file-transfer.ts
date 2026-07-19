/**
 * ssh-file-transfer.ts — bounded SCP transfers over DaoFlow's pinned SSH transport.
 */

import { spawn, type ChildProcess } from "node:child_process";
import type { OnLog } from "./docker-executor";
import { scpCommand, withCommandPath } from "./command-env";
import { scpTransportArgs, type SSHTarget } from "./ssh-connection";

export const MAX_SCP_TRANSFER_TIMEOUT_MS = 600_000;

export interface ScpTransferOptions {
  /** A request can shorten the ceiling, but file transfers never exceed ten minutes. */
  timeoutMs?: number;
  /** Allows an activity cancellation to terminate the SCP process. */
  signal?: AbortSignal;
}

export interface ScpTransferResult {
  exitCode: number;
  signal: string | null;
}

/** Upload a local file using the approved host-key-pinned SSH transport. */
export async function scpUpload(
  target: SSHTarget,
  localPath: string,
  remotePath: string,
  onLog: OnLog,
  options?: ScpTransferOptions | AbortSignal
): Promise<ScpTransferResult> {
  const transport = scpTransportArgs(target);
  return runScp(
    target,
    [...transport.args, localPath, `${transport.destination}:${remotePath}`],
    `${localPath} → ${remotePath}`,
    onLog,
    normalizeTransferOptions(options)
  );
}

function normalizeTransferOptions(
  options: ScpTransferOptions | AbortSignal | undefined
): ScpTransferOptions | undefined {
  if (!options) return undefined;
  return "aborted" in options ? { signal: options } : options;
}

/** Download a remote file using the approved host-key-pinned SSH transport. */
export async function scpDownload(
  target: SSHTarget,
  remotePath: string,
  localPath: string,
  onLog: OnLog,
  options?: ScpTransferOptions
): Promise<ScpTransferResult> {
  const transport = scpTransportArgs(target);
  return runScp(
    target,
    [...transport.args, `${transport.destination}:${remotePath}`, localPath],
    `${remotePath} → ${localPath}`,
    onLog,
    options
  );
}

function runScp(
  target: SSHTarget,
  args: string[],
  transfer: string,
  onLog: OnLog,
  options?: ScpTransferOptions
): Promise<ScpTransferResult> {
  return new Promise((resolve, reject) => {
    if (options?.signal?.aborted) {
      reject(new Error("SCP transfer was cancelled before it started."));
      return;
    }

    const timeoutMs = resolveTransferTimeout(options?.timeoutMs);
    onLog({
      stream: "stdout",
      message: `[scp] ${target.serverName} → ${transfer}`,
      timestamp: new Date()
    });

    let child: ChildProcess;
    try {
      child = spawn(scpCommand, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: withCommandPath(process.env)
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    let settled = false;
    let forceKillTimer: NodeJS.Timeout | undefined;
    const timeoutTimer = setTimeout(() => {
      settleFailure(new Error(`SCP transfer timed out after ${timeoutMs}ms.`));
      terminateChild(child);
    }, timeoutMs);
    timeoutTimer.unref?.();

    const abort = () => {
      settleFailure(new Error("SCP transfer was cancelled."));
      terminateChild(child);
    };
    options?.signal?.addEventListener("abort", abort, { once: true });

    function settleCleanup(): void {
      clearTimeout(timeoutTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      options?.signal?.removeEventListener("abort", abort);
    }

    function settleFailure(error: Error): void {
      if (settled) return;
      settled = true;
      settleCleanup();
      reject(error);
    }

    function terminateChild(process: ChildProcess): void {
      try {
        process.kill("SIGTERM");
      } catch {
        // The process may already have exited.
      }
      forceKillTimer = setTimeout(() => {
        try {
          process.kill("SIGKILL");
        } catch {
          // The process has already exited.
        }
      }, 5_000);
      forceKillTimer.unref?.();
    }

    const logStream = (stream: "stdout" | "stderr", data: Buffer) => {
      const text = data.toString("utf-8").trimEnd();
      if (text.length > 0) {
        onLog({ stream, message: text, timestamp: new Date() });
      }
    };
    child.stdout?.on("data", (data: Buffer) => logStream("stdout", data));
    child.stderr?.on("data", (data: Buffer) => logStream("stderr", data));

    child.on("close", (code, signal) => {
      if (settled) return;
      settled = true;
      settleCleanup();
      resolve({ exitCode: code ?? 1, signal: signal ?? null });
    });
    child.on("error", (err) => settleFailure(err));
  });
}

function resolveTransferTimeout(timeoutMs: number | undefined): number {
  if (timeoutMs === undefined) return MAX_SCP_TRANSFER_TIMEOUT_MS;
  if (!Number.isFinite(timeoutMs) || timeoutMs <= 0) {
    throw new Error("SCP transfer timeout must be a positive finite number.");
  }
  return Math.min(Math.floor(timeoutMs), MAX_SCP_TRANSFER_TIMEOUT_MS);
}
