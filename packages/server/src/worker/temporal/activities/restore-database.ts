import { spawn } from "node:child_process";
import { createReadStream, statSync } from "node:fs";
import { runCancellableLocalCommand } from "../../cancellable-local-command";
import { dockerCommand, sshCommand, withCommandPath } from "../../command-env";
import type { ExecutionTarget } from "../../execution-target";
import { collectDockerJsonLines } from "../../server-host-command";
import { shellQuote, sshArgs } from "../../ssh-connection";
import { redactActivitySecretValue } from "./activity-secret-redaction";
import { findLargestFile } from "./restore-files";
import type { RestoreExecutionResult } from "./restore-execution";

interface DockerRestoreCommand {
  envArgs: string[];
  args: string[];
}

type DatabaseEngine = "postgres" | "mysql" | "mariadb" | "mongo";

export type DatabaseRestoreRuntime =
  | { kind: "container"; containerName: string }
  | { kind: "compose"; projectName: string; serviceName: string };

export type DatabaseRestoreContext = {
  databaseEngine?: string;
  databasePassword?: string;
  databaseUser?: string;
  databaseName?: string;
  containerName?: string;
  serviceName?: string;
  volumeName: string;
  executionTarget?: ExecutionTarget;
  runtime?: DatabaseRestoreRuntime;
};

export type DatabaseRestoreHooks = {
  heartbeat?: () => void;
  cancellationSignal?: AbortSignal;
  timeoutMs?: number;
};

export async function executeDatabaseRestore(
  ctx: DatabaseRestoreContext,
  localPath: string,
  hooksOrSignal: DatabaseRestoreHooks | AbortSignal = {}
): Promise<RestoreExecutionResult> {
  const hooks = normalizeRestoreHooks(hooksOrSignal);
  try {
    throwIfCancelled(hooks.cancellationSignal);
    const engine = normalizeDatabaseEngine(ctx.databaseEngine);
    if (!engine) {
      return {
        success: false,
        bytesRestored: 0,
        error: `Unsupported database restore engine: ${ctx.databaseEngine ?? "missing"}`
      };
    }

    const dumpFile = findLargestFile(localPath);
    if (!dumpFile) {
      return {
        success: false,
        bytesRestored: 0,
        error: `No database dump file was downloaded to ${localPath}`
      };
    }

    const containerName = await resolveDatabaseContainer(ctx);
    if (!containerName) {
      return {
        success: false,
        bytesRestored: 0,
        error:
          "Unable to resolve a database container. Set volume metadata.containerName or metadata.serviceName before restoring."
      };
    }

    await runDockerDatabaseRestore(
      ctx.executionTarget ?? { mode: "local" },
      containerName,
      buildRestoreCommand(ctx, engine),
      dumpFile,
      hooks
    );
    return { success: true, bytesRestored: statSync(dumpFile).size };
  } catch (err) {
    throwIfCancelled(hooks.cancellationSignal);
    return {
      success: false,
      bytesRestored: 0,
      error: redactActivitySecretValue(
        err instanceof Error ? err.message : String(err),
        ctx.databasePassword
      )
    };
  }
}

function normalizeRestoreHooks(
  hooksOrSignal: DatabaseRestoreHooks | AbortSignal
): DatabaseRestoreHooks {
  if (isAbortSignal(hooksOrSignal)) {
    return { cancellationSignal: hooksOrSignal };
  }
  return hooksOrSignal;
}

function isAbortSignal(
  hooksOrSignal: DatabaseRestoreHooks | AbortSignal
): hooksOrSignal is AbortSignal {
  return "aborted" in hooksOrSignal && typeof hooksOrSignal.addEventListener === "function";
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error
      ? signal.reason
      : new Error("Database restore was cancelled.");
  }
}

function normalizeDatabaseEngine(engine: string | undefined): DatabaseEngine | null {
  if (engine === "postgres" || engine === "mysql" || engine === "mariadb" || engine === "mongo") {
    return engine;
  }
  return null;
}

function buildRestoreCommand(
  ctx: DatabaseRestoreContext,
  engine: DatabaseEngine
): DockerRestoreCommand {
  switch (engine) {
    case "postgres": {
      const envArgs = ctx.databasePassword ? ["-e", `PGPASSWORD=${ctx.databasePassword}`] : [];
      return {
        envArgs,
        args: [
          "pg_restore",
          "-U",
          ctx.databaseUser ?? "postgres",
          "-d",
          ctx.databaseName ?? "postgres",
          "--exit-on-error",
          "--clean",
          "--if-exists",
          "--no-owner",
          "--no-privileges"
        ]
      };
    }
    case "mysql":
    case "mariadb": {
      const envArgs = ctx.databasePassword ? ["-e", `MYSQL_PWD=${ctx.databasePassword}`] : [];
      const databaseArgs = ctx.databaseName ? [ctx.databaseName] : [];
      return {
        envArgs,
        args: ["mysql", "-u", ctx.databaseUser ?? "root", ...databaseArgs]
      };
    }
    case "mongo": {
      const args = ["mongorestore", "--archive", "--gzip"];
      if (ctx.databaseUser) {
        args.push(`--username=${ctx.databaseUser}`, "--authenticationDatabase=admin");
      }
      if (ctx.databasePassword) {
        args.push(`--password=${ctx.databasePassword}`);
      }
      if (ctx.databaseName) {
        args.push(`--nsInclude=${ctx.databaseName}.*`);
      }
      return { envArgs: [], args };
    }
  }
}

function runDockerDatabaseRestore(
  target: ExecutionTarget,
  containerName: string,
  command: DockerRestoreCommand,
  dumpFile: string,
  hooks: DatabaseRestoreHooks
): Promise<void> {
  const args = ["exec", "-i", ...command.envArgs, containerName, ...command.args];
  if (target.mode === "local") {
    return runLocalDockerDatabaseRestore(args, dumpFile, hooks);
  }

  return new Promise((resolve, reject) => {
    const input = createReadStream(dumpFile);
    const proc = spawnTargetDockerCommand(target, args, hooks.cancellationSignal);
    let settled = false;
    const stopInput = () => {
      input.unpipe(proc.stdin);
      input.destroy();
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      clearInterval(heartbeatTimer);
      removeAbortListener?.();
      callback();
    };
    const timeout = setTimeout(() => {
      stopInput();
      proc.kill("SIGTERM");
      settle(() => reject(new Error("Database restore timed out after 30 minutes")));
    }, hooks.timeoutMs ?? 1_800_000);
    const heartbeat = () => hooks.heartbeat?.();
    heartbeat();
    const heartbeatTimer = setInterval(heartbeat, 15_000);
    const abort = () => {
      stopInput();
      proc.kill("SIGTERM");
      settle(() => reject(new Error("Database restore was cancelled.")));
    };
    const removeAbortListener = hooks.cancellationSignal
      ? () => hooks.cancellationSignal?.removeEventListener("abort", abort)
      : undefined;
    let stderr = "";

    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (error) => {
      stopInput();
      settle(() => reject(error));
    });
    proc.on("close", (code) => {
      stopInput();
      settle(() =>
        code === 0
          ? resolve()
          : reject(
              new Error(`docker exec restore exited with code ${code}: ${stderr.slice(0, 500)}`)
            )
      );
    });

    input.on("error", (error) => {
      stopInput();
      proc.kill("SIGTERM");
      settle(() => reject(error));
    });
    input.pipe(proc.stdin);
    if (hooks.cancellationSignal) {
      if (hooks.cancellationSignal.aborted) abort();
      else hooks.cancellationSignal.addEventListener("abort", abort, { once: true });
    }
  });
}

async function runLocalDockerDatabaseRestore(
  args: string[],
  dumpFile: string,
  hooks: DatabaseRestoreHooks
): Promise<void> {
  const heartbeat = () => hooks.heartbeat?.();
  heartbeat();
  const heartbeatTimer = setInterval(heartbeat, 15_000);
  try {
    await runCancellableLocalCommand(dockerCommand, args, {
      description: "Database restore failed",
      timeoutMs: hooks.timeoutMs ?? 1_800_000,
      signal: hooks.cancellationSignal,
      env: withCommandPath(process.env),
      stdinFilePath: dumpFile
    });
  } finally {
    clearInterval(heartbeatTimer);
  }
}

function spawnTargetDockerCommand(target: ExecutionTarget, args: string[], signal?: AbortSignal) {
  if (target.mode === "local") {
    return spawn(dockerCommand, args, {
      stdio: ["pipe", "pipe", "pipe"],
      env: withCommandPath(process.env),
      signal
    });
  }
  const remoteCommand = [dockerCommand, ...args].map((arg) => shellQuote(arg)).join(" ");
  return spawn(sshCommand, [...sshArgs(target.ssh), remoteCommand], {
    stdio: ["pipe", "pipe", "pipe"],
    env: withCommandPath(process.env),
    signal
  });
}

async function resolveDatabaseContainer(ctx: DatabaseRestoreContext): Promise<string | null> {
  if (ctx.containerName) {
    return ctx.containerName;
  }
  if (ctx.runtime?.kind === "container") return ctx.runtime.containerName;
  const serviceName = ctx.runtime?.kind === "compose" ? ctx.runtime.serviceName : ctx.serviceName;
  if (!serviceName) return null;
  const args = ["ps", "--format", "{{.Names}}"];
  if (ctx.runtime?.kind === "compose") {
    args.push("--filter", `label=com.docker.compose.project=${ctx.runtime.projectName}`);
  }
  args.push("--filter", `label=com.docker.compose.service=${serviceName}`);
  const result = await collectDockerJsonLines(ctx.executionTarget ?? { mode: "local" }, args);
  const names = result.stdout.map((line) => line.trim()).filter(Boolean);
  return result.exitCode === 0 && names.length === 1 ? names[0] : null;
}

export const restoreDatabaseTestHooks = {
  buildRestoreCommand,
  normalizeDatabaseEngine,
  resolveDatabaseContainer,
  runDockerDatabaseRestore,
  spawnTargetDockerCommand
};
