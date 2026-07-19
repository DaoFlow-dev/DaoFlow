import { spawn, type ChildProcess } from "node:child_process";
import { constants } from "node:os";

const MAX_NATIVE_RESTARTS = 2;
const RESTART_DELAY_MS = 750;
const SHUTDOWN_GRACE_PERIOD_MS = 5_000;
const NATIVE_RUNTIME_SIGNALS = new Set<NodeJS.Signals>(["SIGABRT", "SIGILL", "SIGSEGV"]);
const NATIVE_RUNTIME_EXIT_CODES = new Set([132, 134, 139]);

export type ServerExit = {
  code: number | null;
  signal: NodeJS.Signals | null;
};

type SupervisorOptions = {
  runServer?: () => Promise<ServerExit>;
  wait?: (delayMs: number) => Promise<void>;
  log?: (message: string) => void;
  maxRestarts?: number;
  restartDelayMs?: number;
  isStopping?: () => boolean;
};

let activeServer: ChildProcess | undefined;
let shutdownSignal: NodeJS.Signals | undefined;
let forcedShutdownTimer: ReturnType<typeof setTimeout> | undefined;

function describeExit({ code, signal }: ServerExit) {
  return signal ?? (code === null ? "unknown termination" : `exit code ${code}`);
}

function exitCodeFor({ code, signal }: ServerExit) {
  if (code !== null) {
    return code;
  }

  return signal ? 128 + constants.signals[signal] : 1;
}

export function isNativeRuntimeTermination({ code, signal }: ServerExit) {
  return (
    (signal !== null && NATIVE_RUNTIME_SIGNALS.has(signal)) ||
    (code !== null && NATIVE_RUNTIME_EXIT_CODES.has(code))
  );
}

export async function superviseE2eServer({
  runServer = runServerProcess,
  wait = (delayMs) => new Promise((resolve) => setTimeout(resolve, delayMs)),
  log = console.log,
  maxRestarts = MAX_NATIVE_RESTARTS,
  restartDelayMs = RESTART_DELAY_MS,
  isStopping = () => shutdownSignal !== undefined
}: SupervisorOptions = {}): Promise<ServerExit> {
  let restartCount = 0;

  while (true) {
    if (isStopping()) {
      return { code: 1, signal: null };
    }

    const result = await runServer();

    if (isStopping() || !isNativeRuntimeTermination(result)) {
      return result;
    }

    if (restartCount >= maxRestarts) {
      log(
        `[playwright-e2e-server] Native runtime termination (${describeExit(result)}) ` +
          `exhausted the ${maxRestarts}-restart limit; propagating failure.`
      );
      return result;
    }

    restartCount += 1;
    log(
      `[playwright-e2e-server] Native runtime termination (${describeExit(result)}); ` +
        `restarting server (${restartCount}/${maxRestarts}) in ${restartDelayMs}ms.`
    );
    await wait(restartDelayMs);
  }
}

function runServerProcess(): Promise<ServerExit> {
  const child = spawn("bun", ["run", "start:e2e"], {
    detached: process.platform !== "win32",
    stdio: "inherit"
  });
  activeServer = child;

  return new Promise((resolve) => {
    let settled = false;
    const finish = (result: ServerExit) => {
      if (settled) {
        return;
      }

      settled = true;
      if (activeServer === child) {
        activeServer = undefined;
      }
      if (forcedShutdownTimer) {
        clearTimeout(forcedShutdownTimer);
        forcedShutdownTimer = undefined;
      }
      resolve(result);
    };

    child.once("error", (error) => {
      console.error(`[playwright-e2e-server] Could not start E2E server: ${error.message}`);
      finish({ code: 1, signal: null });
    });
    child.once("exit", (code, signal) => finish({ code, signal }));
  });
}

function signalServerProcess(child: ChildProcess, signal: NodeJS.Signals) {
  if (child.pid && process.platform !== "win32") {
    try {
      process.kill(-child.pid, signal);
      return;
    } catch {}
  }

  child.kill(signal);
}

function forwardTermination(signal: NodeJS.Signals) {
  if (shutdownSignal) {
    return;
  }

  shutdownSignal = signal;
  const child = activeServer;
  if (!child) {
    return;
  }

  console.log(`[playwright-e2e-server] Forwarding ${signal} to the E2E server.`);
  signalServerProcess(child, signal);
  forcedShutdownTimer = setTimeout(() => {
    if (activeServer === child) {
      console.error(
        `[playwright-e2e-server] E2E server did not stop after ${signal}; forcing shutdown.`
      );
      signalServerProcess(child, "SIGKILL");
    }
  }, SHUTDOWN_GRACE_PERIOD_MS);
  forcedShutdownTimer.unref();
}

async function main() {
  for (const signal of ["SIGINT", "SIGTERM", "SIGHUP"] as const) {
    process.on(signal, () => forwardTermination(signal));
  }

  const result = await superviseE2eServer();
  process.exitCode = shutdownSignal
    ? exitCodeFor({ code: null, signal: shutdownSignal })
    : exitCodeFor(result);
}

if (import.meta.main) {
  void main();
}
