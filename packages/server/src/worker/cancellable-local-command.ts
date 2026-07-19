import { spawn, type ChildProcess } from "node:child_process";
import { createReadStream, type ReadStream } from "node:fs";

const STDERR_LIMIT_BYTES = 16 * 1024;
const FORCE_KILL_AFTER_MS = 5_000;
const STOP_WAIT_LIMIT_MS = 10_000;

export interface CancellableLocalCommandOptions {
  description: string;
  timeoutMs: number;
  signal?: AbortSignal;
  cwd?: string;
  env?: NodeJS.ProcessEnv;
  stdinFilePath?: string;
  redact?: (value: string) => string;
}

export function runCancellableLocalCommand(
  command: string,
  args: string[],
  options: CancellableLocalCommandOptions
): Promise<void> {
  throwIfCancelled(options.signal);
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        stdio: [options.stdinFilePath ? "pipe" : "ignore", "ignore", "pipe"],
        cwd: options.cwd,
        env: options.env
      });
    } catch (error) {
      reject(commandFailure(options, error));
      return;
    }

    let stderr = "";
    let input: ReadStream | undefined;
    let settled = false;
    let stoppingError: Error | null = null;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    let stopWaitTimer: ReturnType<typeof setTimeout> | undefined;
    const commandTimer = setTimeout(
      () => requestStop(new Error(`${options.description}: timed out.`)),
      options.timeoutMs
    );
    commandTimer.unref?.();

    const finish = (action: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(commandTimer);
      if (forceKillTimer) clearTimeout(forceKillTimer);
      if (stopWaitTimer) clearTimeout(stopWaitTimer);
      options.signal?.removeEventListener("abort", abort);
      input?.destroy();
      action();
    };
    const requestStop = (error: Error) => {
      if (stoppingError || settled) return;
      stoppingError = error;
      stopChild(child, "SIGTERM");
      forceKillTimer = setTimeout(() => stopChild(child, "SIGKILL"), FORCE_KILL_AFTER_MS);
      forceKillTimer.unref?.();
      stopWaitTimer = setTimeout(() => finish(() => reject(error)), STOP_WAIT_LIMIT_MS);
      stopWaitTimer.unref?.();
    };
    const abort = () => requestStop(cancellationReason(options.signal));

    child.stderr?.on("data", (chunk: Buffer) => {
      if (stderr.length < STDERR_LIMIT_BYTES) {
        stderr += chunk.toString("utf8").slice(0, STDERR_LIMIT_BYTES - stderr.length);
      }
    });
    child.on("error", (error) => {
      finish(() => reject(stoppingError ?? commandFailure(options, error)));
    });
    child.on("close", (status) => {
      const stopFailure = stoppingError;
      if (stopFailure) {
        finish(() => reject(stopFailure));
      } else if (status === 0) {
        finish(resolve);
      } else {
        const detail = stderr.trim() || `exit code ${status ?? "unknown"}`;
        finish(() => reject(new Error(`${options.description}: ${redact(options, detail)}`)));
      }
    });
    options.signal?.addEventListener("abort", abort, { once: true });
    if (options.signal?.aborted) abort();
    if (options.stdinFilePath && !settled && !stoppingError) {
      if (!child.stdin) {
        requestStop(new Error(`${options.description}: command stdin is unavailable.`));
      } else {
        input = createReadStream(options.stdinFilePath);
        input.on("error", (error) => requestStop(commandFailure(options, error)));
        child.stdin.on("error", (error) => requestStop(commandFailure(options, error)));
        input.pipe(child.stdin);
      }
    }
  });
}

function commandFailure(options: CancellableLocalCommandOptions, error: unknown): Error {
  const detail = error instanceof Error ? error.message : String(error);
  return new Error(`${options.description}: ${redact(options, detail)}`);
}

function redact(options: CancellableLocalCommandOptions, value: string): string {
  return options.redact ? options.redact(value) : value;
}

function stopChild(child: ChildProcess, signal: NodeJS.Signals): void {
  try {
    child.kill(signal);
  } catch {
    // The command may have already stopped.
  }
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationReason(signal);
}

function cancellationReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("Local command was cancelled.");
}
