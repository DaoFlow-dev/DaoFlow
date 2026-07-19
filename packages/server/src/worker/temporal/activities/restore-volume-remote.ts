import { randomBytes } from "node:crypto";
import { mkdir, readdir, rm, stat } from "node:fs/promises";
import { hostname, tmpdir } from "node:os";
import { join } from "node:path";
import { runCancellableLocalCommand } from "../../cancellable-local-command";
import type { RestoreExecutionContext, RestoreExecutionResult } from "./restore-execution";
import { runWithRemoteTransferActivity } from "./remote-transfer-activity";
import { restoreRemoteVolumeArchive } from "./remote-volume-transfer";

const ARCHIVE_SUFFIXES = [".tar.zst", ".tar.gz", ".tgz", ".tar", ".7z", ".zip"];
const LOCAL_COMMAND_TIMEOUT_MS = 300_000;
const localHostname = hostname().toLowerCase();

type RemoteVolumeRestoreExecutionContext = RestoreExecutionContext & {
  mode: "restore";
  serverId: string;
  teamId: string;
  serverHost: string;
  mountPath: string;
};

export async function executeRemoteVolumeRestore(
  ctx: RestoreExecutionContext,
  localPath: string
): Promise<RestoreExecutionResult | null> {
  if (!hasRemoteVolumeRestoreContext(ctx)) return null;

  return runWithRemoteTransferActivity((signal) =>
    executeRemoteVolumeRestoreWithSignal(ctx, localPath, signal)
  );
}

async function executeRemoteVolumeRestoreWithSignal(
  ctx: RemoteVolumeRestoreExecutionContext,
  localPath: string,
  signal?: AbortSignal
): Promise<RestoreExecutionResult | null> {
  const prepared = await prepareRemoteVolumeArchive(ctx, localPath, signal);
  if (!prepared.success) {
    return { success: false, bytesRestored: 0, error: prepared.error };
  }

  let outcome: RestoreExecutionResult | null;
  try {
    const result = await restoreRemoteVolumeArchive(
      {
        serverId: ctx.serverId,
        teamId: ctx.teamId,
        volumeName: ctx.volumeName,
        mountPath: ctx.mountPath,
        sourceKind: ctx.sourceKind
      },
      ctx.restoreId,
      prepared.archivePath
    );
    outcome = result ? { success: true, bytesRestored: result.bytesRestored } : null;
  } catch (err) {
    outcome = {
      success: false,
      bytesRestored: 0,
      error: err instanceof Error ? err.message : String(err)
    };
  }
  const cleanupErrors = await cleanupLocalPaths(prepared.cleanupPaths);
  if (signal?.aborted) throw cancellationWithCleanup(signal, cleanupErrors);
  if (cleanupErrors.length > 0) {
    return {
      success: false,
      bytesRestored: outcome?.bytesRestored ?? 0,
      error: [outcome?.error, ...cleanupErrors].filter(Boolean).join(" ")
    };
  }
  return outcome;
}

function hasRemoteVolumeRestoreContext(
  ctx: RestoreExecutionContext
): ctx is RemoteVolumeRestoreExecutionContext {
  const host = ctx.serverHost?.trim().toLowerCase();
  return (
    ctx.mode === "restore" &&
    Boolean(ctx.serverId && ctx.teamId && host && ctx.mountPath) &&
    host !== "localhost" &&
    host !== "127.0.0.1" &&
    host !== "::1" &&
    host !== "host.docker.internal" &&
    host !== localHostname
  );
}

type PreparedRemoteVolumeArchive =
  | { success: true; archivePath: string; cleanupPaths: string[] }
  | { success: false; error: string };

export async function prepareRemoteVolumeArchive(
  ctx: RestoreExecutionContext,
  localPath: string,
  signal?: AbortSignal
): Promise<PreparedRemoteVolumeArchive> {
  throwIfCancelled(signal);
  try {
    await stat(localPath);
  } catch {
    return { success: false, error: `Downloaded path ${localPath} is missing` };
  }
  const cleanupPaths: string[] = [];
  let archiveRoot = localPath;
  try {
    if (ctx.encryptionMode === "archive-7z" || ctx.encryptionMode === "archive-zip") {
      const password = ctx.destination.encryptionPassword;
      if (!password) {
        return {
          success: false,
          error: "Encrypted archive restore requires a destination encryption password."
        };
      }
      const encryptedArchive = await findRestoreArchive(localPath);
      if (!encryptedArchive) {
        return { success: false, error: "Encrypted volume archive was not downloaded." };
      }
      const decryptedDir = join(localPath, "remote-volume-decrypted");
      cleanupPaths.push(decryptedDir);
      await decryptArchive(encryptedArchive, password, decryptedDir, signal);
      archiveRoot = decryptedDir;
    }

    const existingArchive = await findRestoreArchive(archiveRoot);
    throwIfCancelled(signal);
    if (existingArchive?.toLowerCase().endsWith(".tar")) {
      return { success: true, archivePath: existingArchive, cleanupPaths };
    }

    if (existingArchive) {
      const extractedDir = join(
        localPath,
        `remote-volume-extracted-${randomBytes(8).toString("hex")}`
      );
      cleanupPaths.push(extractedDir);
      await extractUnencryptedArchive(existingArchive, extractedDir, signal);
      archiveRoot = extractedDir;
    }

    const archivePath = join(
      tmpdir(),
      `daoflow-remote-volume-${randomBytes(12).toString("hex")}.tar`
    );
    cleanupPaths.push(archivePath);
    await runLocalCommand("tar", ["-C", archiveRoot, "-cf", archivePath, "."], signal);
    return { success: true, archivePath, cleanupPaths };
  } catch (err) {
    const cleanupErrors = await cleanupLocalPaths(cleanupPaths);
    if (signal?.aborted) throw cancellationWithCleanup(signal, cleanupErrors);
    return {
      success: false,
      error: [err instanceof Error ? err.message : String(err), ...cleanupErrors].join(" ")
    };
  }
}

async function cleanupLocalPaths(paths: string[]): Promise<string[]> {
  const errors: string[] = [];
  for (const path of paths) {
    try {
      await rm(path, { recursive: true, force: true });
    } catch (error) {
      const detail = error instanceof Error ? error.message : String(error);
      errors.push(`Could not remove plaintext restore staging: ${detail}`);
    }
  }
  return errors;
}

async function findRestoreArchive(root: string): Promise<string | null> {
  let rootStats;
  try {
    rootStats = await stat(root);
  } catch {
    return null;
  }
  if (rootStats.isFile())
    return ARCHIVE_SUFFIXES.some((suffix) => root.toLowerCase().endsWith(suffix)) ? root : null;
  if (!rootStats.isDirectory()) return null;

  const entries = await readdir(root, { withFileTypes: true });
  for (const entry of entries) {
    const path = join(root, entry.name);
    if (entry.isFile() && ARCHIVE_SUFFIXES.some((suffix) => path.toLowerCase().endsWith(suffix)))
      return path;
    if (entry.isDirectory()) {
      const nested = await findRestoreArchive(path);
      if (nested) return nested;
    }
  }
  return null;
}

async function decryptArchive(
  archivePath: string,
  password: string,
  outputPath: string,
  signal?: AbortSignal
): Promise<void> {
  await mkdir(outputPath, { recursive: true });
  await runLocalCommand(
    "7z",
    ["x", `-p${password}`, `-o${outputPath}`, "-y", archivePath],
    signal,
    password
  );
}

async function extractUnencryptedArchive(
  archivePath: string,
  outputPath: string,
  signal?: AbortSignal
): Promise<void> {
  await mkdir(outputPath, { recursive: true });
  const lower = archivePath.toLowerCase();
  if (lower.endsWith(".tar.zst")) {
    await runLocalCommand("tar", ["-I", "zstd", "-xf", archivePath, "-C", outputPath], signal);
  } else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    await runLocalCommand("tar", ["-xzf", archivePath, "-C", outputPath], signal);
  } else if (lower.endsWith(".tar")) {
    await runLocalCommand("tar", ["-xf", archivePath, "-C", outputPath], signal);
  } else {
    await runLocalCommand("7z", ["x", `-o${outputPath}`, "-y", archivePath], signal);
  }
}

function runLocalCommand(
  command: string,
  args: string[],
  signal?: AbortSignal,
  secret?: string
): Promise<void> {
  return runCancellableLocalCommand(command, args, {
    description: `${command} failed while preparing a volume restore`,
    timeoutMs: LOCAL_COMMAND_TIMEOUT_MS,
    signal,
    redact: (value) => redactSecret(value, secret)
  });
}

function redactSecret(value: string, secret?: string): string {
  return secret ? value.replaceAll(secret, "[redacted]") : value;
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) throw cancellationReason(signal);
}

function cancellationReason(signal?: AbortSignal): Error {
  return signal?.reason instanceof Error
    ? signal.reason
    : new Error("Remote volume restore was cancelled.");
}

function cancellationWithCleanup(signal: AbortSignal, cleanupErrors: string[]): Error {
  const cancellation = cancellationReason(signal);
  if (cleanupErrors.length === 0) return cancellation;
  const cleanup = new Error(cleanupErrors.join(" "));
  return new Error(`${cancellation.message} Cleanup also failed: ${cleanup.message}`, {
    cause: new AggregateError([cancellation, cleanup], "Cancellation and cleanup failures.")
  });
}

export const restoreVolumeRemoteTestHooks = { cancellationWithCleanup };
