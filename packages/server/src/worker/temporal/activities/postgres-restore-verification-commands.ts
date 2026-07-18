import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { dockerCommand, withCommandPath } from "../../command-env";

export const POSTGRES_VERIFICATION_TIMEOUT_MS = 15 * 60 * 1000;
export const POSTGRES_CLEANUP_TIMEOUT_MS = 30 * 1000;
export const POSTGRES_VERIFICATION_HEARTBEAT_INTERVAL_MS = 30 * 1000;
const READINESS_TIMEOUT_MS = 30 * 1000;
const ERROR_LIMIT = 500;
const CATALOG_COUNTS_SQL =
  "SELECT json_build_object('schemas', (SELECT count(*)::int FROM pg_catalog.pg_namespace WHERE nspname !~ '^pg_' AND nspname <> 'information_schema'), 'tables', (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind IN ('r', 'p') AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'), 'indexes', (SELECT count(*)::int FROM pg_catalog.pg_class c JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace WHERE c.relkind = 'i' AND n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'), 'functions', (SELECT count(*)::int FROM pg_catalog.pg_proc p JOIN pg_catalog.pg_namespace n ON n.oid = p.pronamespace WHERE n.nspname !~ '^pg_' AND n.nspname <> 'information_schema'))::text;";

export interface PostgresRestoreVerificationCommand {
  args: string[];
  timeoutMs: number;
  stdinPath?: string;
  abortSignal?: AbortSignal;
}

export interface PostgresRestoreVerifierHooks {
  runCommand: (command: PostgresRestoreVerificationCommand) => Promise<{ stdout: string }>;
  now: () => number;
  completedAt: () => string;
  sleep: (durationMs: number) => Promise<void>;
  heartbeat: () => void;
  heartbeatIntervalMs: number;
  cancellationSignal: AbortSignal;
}

export interface VerificationContainer {
  name: string;
  databaseName: string;
  databaseUser: string;
  restoreId: string;
}

export class VerificationTimeoutError extends Error {
  constructor() {
    super("Verification timed out after 15 minutes.");
  }
}

export const defaultPostgresRestoreVerifierHooks: PostgresRestoreVerifierHooks = {
  runCommand: runDockerCommand,
  now: Date.now,
  completedAt: () => new Date().toISOString(),
  sleep: (ms) => new Promise((done) => setTimeout(done, ms)),
  heartbeat: () => undefined,
  heartbeatIntervalMs: POSTGRES_VERIFICATION_HEARTBEAT_INTERVAL_MS,
  cancellationSignal: new AbortController().signal
};

export function verificationCommand(
  args: string[],
  timeoutMs = POSTGRES_VERIFICATION_TIMEOUT_MS,
  stdinPath?: string
): PostgresRestoreVerificationCommand {
  return { args, timeoutMs, ...(stdinPath ? { stdinPath } : {}) };
}

export function makeVerificationContainer(restoreId: string): VerificationContainer {
  const suffix = createHash("sha256").update(restoreId).digest("hex").slice(0, 24);
  return {
    name: `daoflow-pg-verify-${suffix}`,
    databaseName: `verify_db_${suffix}`,
    databaseUser: `verify_user_${suffix}`,
    restoreId
  };
}

export function archiveInspectionCommand(
  image: string,
  dumpPath: string
): PostgresRestoreVerificationCommand {
  return verificationCommand(
    dockerArgs`run --rm --interactive --pull=never --network none --read-only --cap-drop ALL --security-opt no-new-privileges:true --pids-limit 64 --cpus 0.5 --memory 256m --memory-swap 256m --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777 ${image} pg_restore --format=custom --list`,
    POSTGRES_VERIFICATION_TIMEOUT_MS,
    dumpPath
  );
}

export function createVerificationContainerCommand(
  image: string,
  container: VerificationContainer
): PostgresRestoreVerificationCommand {
  return verificationCommand(
    dockerArgs`create --name ${container.name} --pull=never --network none --read-only --cap-drop ALL --cap-add CHOWN --cap-add DAC_OVERRIDE --cap-add FOWNER --cap-add SETGID --cap-add SETUID --security-opt no-new-privileges:true --pids-limit 128 --cpus 1.0 --memory 1g --memory-swap 1g --tmpfs /var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=512m,mode=0700 --tmpfs /tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777 --tmpfs /var/run/postgresql:rw,nosuid,nodev,noexec,size=16m,mode=0775 --label com.daoflow.restore-verification=true --label ${`com.daoflow.restore-verification-id=${container.restoreId}`} --label com.daoflow.cleanup=required --env ${`POSTGRES_DB=${container.databaseName}`} --env ${`POSTGRES_USER=${container.databaseUser}`} --env POSTGRES_HOST_AUTH_METHOD=trust --env PGDATA=/var/lib/postgresql/data ${image}`
  );
}

export function postgresRestoreCommand(
  container: VerificationContainer,
  dumpPath: string
): PostgresRestoreVerificationCommand {
  return verificationCommand(
    dockerArgs`exec --interactive ${container.name} pg_restore --format=custom --exit-on-error --clean --if-exists --no-owner --no-privileges --username ${container.databaseUser} --dbname ${container.databaseName}`,
    POSTGRES_VERIFICATION_TIMEOUT_MS,
    dumpPath
  );
}

export function postgresCatalogCommand(
  container: VerificationContainer
): PostgresRestoreVerificationCommand {
  return verificationCommand(
    dockerArgs`exec ${container.name} psql --username ${container.databaseUser} --dbname ${container.databaseName} --tuples-only --no-align --quiet --no-psqlrc --set=ON_ERROR_STOP=1 --command ${CATALOG_COUNTS_SQL}`
  );
}

export async function waitForPostgresReadiness(
  hooks: PostgresRestoreVerifierHooks,
  startedAt: number,
  container: VerificationContainer
): Promise<void> {
  if (hooks.now() >= startedAt + POSTGRES_VERIFICATION_TIMEOUT_MS) {
    throw new VerificationTimeoutError();
  }
  const deadline = Math.min(
    startedAt + POSTGRES_VERIFICATION_TIMEOUT_MS,
    hooks.now() + READINESS_TIMEOUT_MS
  );
  while (hooks.now() < deadline) {
    try {
      await beforePostgresVerificationDeadline(
        hooks,
        startedAt,
        verificationCommand(
          dockerArgs`exec ${container.name} pg_isready --username ${container.databaseUser} --dbname ${container.databaseName} --host 127.0.0.1`,
          READINESS_TIMEOUT_MS
        ),
        "Verifier readiness command failed."
      );
      return;
    } catch (error) {
      if (error instanceof VerificationTimeoutError) throw error;
      if (hooks.now() >= deadline) break;
      await hooks.sleep(Math.min(500, deadline - hooks.now()));
    }
  }
  throw new Error("Isolated PostgreSQL verifier did not become ready in time.");
}

export async function beforePostgresVerificationDeadline(
  hooks: PostgresRestoreVerifierHooks,
  startedAt: number,
  operation: PostgresRestoreVerificationCommand,
  failure: string
): Promise<{ stdout: string }> {
  const remainingMs = startedAt + POSTGRES_VERIFICATION_TIMEOUT_MS - hooks.now();
  if (remainingMs <= 0) throw new VerificationTimeoutError();
  throwIfCancelled(hooks.cancellationSignal);
  hooks.heartbeat();
  const heartbeatTimer = setInterval(hooks.heartbeat, hooks.heartbeatIntervalMs);
  let removeCancellationListener: (() => void) | undefined;
  try {
    const cancellation = new Promise<never>((_, reject) => {
      const rejectCancellation = () => reject(cancellationReason(hooks.cancellationSignal));
      hooks.cancellationSignal.addEventListener("abort", rejectCancellation, { once: true });
      removeCancellationListener = () =>
        hooks.cancellationSignal.removeEventListener("abort", rejectCancellation);
    });
    return await Promise.race([
      hooks.runCommand({
        ...operation,
        timeoutMs: Math.min(operation.timeoutMs, remainingMs),
        abortSignal: hooks.cancellationSignal
      }),
      cancellation
    ]);
  } catch (error) {
    if (hooks.cancellationSignal.aborted) throw cancellationReason(hooks.cancellationSignal);
    if (error instanceof VerificationTimeoutError) throw error;
    throw new Error(failure);
  } finally {
    clearInterval(heartbeatTimer);
    removeCancellationListener?.();
  }
}

function dockerArgs(parts: TemplateStringsArray, ...values: string[]): string[] {
  return parts.flatMap((part, index) => [
    ...part.trim().split(/\s+/).filter(Boolean),
    ...(index < values.length ? [values[index]] : [])
  ]);
}

function runDockerCommand(
  commandInput: PostgresRestoreVerificationCommand
): Promise<{ stdout: string }> {
  return new Promise((resolveCommand, rejectCommand) => {
    const child = spawn(dockerCommand, commandInput.args, {
      env: withCommandPath(process.env),
      stdio: [commandInput.stdinPath ? "pipe" : "ignore", "pipe", "pipe"]
    });
    let stdout = "";
    let stderr = "";
    let settled = false;
    let input: ReturnType<typeof createReadStream> | undefined;
    let removeAbortListener: (() => void) | undefined;
    const stopInput = () => {
      if (!input) return;
      input.unpipe(child.stdin ?? undefined);
      input.destroy();
      input = undefined;
    };
    const settle = (callback: () => void) => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      removeAbortListener?.();
      stopInput();
      callback();
    };
    const timeout = setTimeout(() => {
      stopInput();
      child.kill("SIGTERM");
      settle(() => rejectCommand(new VerificationTimeoutError()));
    }, commandInput.timeoutMs);
    child.stdout!.on("data", (chunk: Buffer) => {
      stdout += chunk.toString();
    });
    child.stderr!.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      stopInput();
      settle(() => rejectCommand(error));
    });
    child.on("close", (code) =>
      settle(() =>
        code === 0
          ? resolveCommand({ stdout })
          : rejectCommand(
              new Error(`Docker command exited with code ${code}: ${stderr.slice(0, ERROR_LIMIT)}`)
            )
      )
    );
    if (commandInput.stdinPath && child.stdin) {
      input = createReadStream(commandInput.stdinPath);
      input.on("error", (error) => {
        stopInput();
        child.kill("SIGTERM");
        settle(() => rejectCommand(error));
      });
      child.stdin.on("error", (error) => {
        stopInput();
        child.kill("SIGTERM");
        settle(() => rejectCommand(error));
      });
      input.pipe(child.stdin);
    }
    if (commandInput.abortSignal) {
      const abort = () => {
        stopInput();
        child.kill("SIGTERM");
        settle(() => rejectCommand(cancellationReason(commandInput.abortSignal as AbortSignal)));
      };
      if (commandInput.abortSignal.aborted) {
        abort();
      } else {
        commandInput.abortSignal.addEventListener("abort", abort, { once: true });
        removeAbortListener = () => commandInput.abortSignal?.removeEventListener("abort", abort);
      }
    }
  });
}

function throwIfCancelled(signal: AbortSignal): void {
  if (signal.aborted) throw cancellationReason(signal);
}

function cancellationReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("PostgreSQL restore verification was cancelled.");
}

export const postgresRestoreVerificationCommandTestHooks = { runDockerCommand };
