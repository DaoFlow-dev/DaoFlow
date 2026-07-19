import { mkdir, stat } from "node:fs/promises";
import { join } from "node:path";
import { runCancellableLocalCommand } from "../../cancellable-local-command";
import type { DestinationConfig } from "../../rclone-executor";
import type { RestoreResolved } from "./restore-activities";
import { executeDatabaseRestore } from "./restore-database";
import { byteSizeOfPath, findFiles } from "./restore-files";
import { executeRemoteVolumeRestore, prepareRemoteVolumeArchive } from "./restore-volume-remote";

export interface RestoreExecutionResult {
  success: boolean;
  bytesRestored: number;
  error?: string;
}

/**
 * Secret-bearing context created inside executeRestore. This must never be
 * returned from or passed to a Temporal workflow.
 */
export interface RestoreExecutionContext extends RestoreResolved {
  destination: DestinationConfig;
  databasePassword?: string;
}

const ARCHIVE_SUFFIXES = [".tar.zst", ".tar.gz", ".tgz", ".tar", ".7z", ".zip"];
export async function executeRestoreArtifact(
  ctx: RestoreExecutionContext,
  localPath: string,
  signal?: AbortSignal
): Promise<RestoreExecutionResult> {
  if (ctx.backupType === "database") {
    const prepared = await prepareDatabaseRestorePath(ctx, localPath, signal);
    if (!prepared.success) {
      return { success: false, bytesRestored: 0, error: prepared.error };
    }
    return executeDatabaseRestore(ctx, prepared.path, signal);
  }

  return executeVolumeRestore(ctx, localPath, signal);
}

async function executeVolumeRestore(
  ctx: RestoreExecutionContext,
  localPath: string,
  signal?: AbortSignal
): Promise<RestoreExecutionResult> {
  const remoteResult = await executeRemoteVolumeRestore(ctx, localPath);
  if (remoteResult) return remoteResult;

  return executeLocalVolumeRestore(ctx, localPath, signal);
}

async function executeLocalVolumeRestore(
  ctx: RestoreExecutionContext,
  localPath: string,
  signal?: AbortSignal
): Promise<RestoreExecutionResult> {
  try {
    if (!(await pathExists(localPath))) {
      return { success: false, bytesRestored: 0, error: `Downloaded path ${localPath} is missing` };
    }

    const targetPath = ctx.targetPath;
    if (!targetPath) {
      return { success: false, bytesRestored: 0, error: "Volume restore target is missing." };
    }

    await mkdir(targetPath, { recursive: true });
    const archive = findRestoreArchive(localPath);

    if (archive) {
      const extracted = await extractArchiveToDirectory(ctx, archive, targetPath, signal);
      if (!extracted.success) {
        return extracted;
      }
    }

    const bytesRestored = byteSizeOfPath(targetPath);
    return { success: true, bytesRestored };
  } catch (err) {
    throwIfCancelled(signal);
    return {
      success: false,
      bytesRestored: 0,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

async function extractArchiveToDirectory(
  ctx: RestoreExecutionContext,
  archivePath: string,
  outputPath: string,
  signal?: AbortSignal
): Promise<RestoreExecutionResult> {
  try {
    if (ctx.encryptionMode === "archive-7z" || ctx.encryptionMode === "archive-zip") {
      const password = ctx.destination.encryptionPassword;
      if (!password) {
        return {
          success: false,
          bytesRestored: 0,
          error: "Encrypted archive restore requires a destination encryption password."
        };
      }
      await runRestoreCommand(
        "7z",
        ["x", `-p${password}`, `-o${outputPath}`, "-y", archivePath],
        signal,
        password
      );
    } else {
      await extractUnencryptedArchive(archivePath, outputPath, signal);
    }
    return { success: true, bytesRestored: byteSizeOfPath(outputPath) };
  } catch (error) {
    throwIfCancelled(signal);
    return {
      success: false,
      bytesRestored: byteSizeOfPath(outputPath),
      error: error instanceof Error ? error.message : String(error)
    };
  }
}

export async function prepareDatabaseRestorePath(
  ctx: RestoreExecutionContext,
  localPath: string,
  signal?: AbortSignal
): Promise<{ success: true; path: string } | { success: false; error: string }> {
  if (ctx.encryptionMode !== "archive-7z" && ctx.encryptionMode !== "archive-zip") {
    return { success: true, path: localPath };
  }

  const archivePath = findRestoreArchive(localPath);
  if (!archivePath) {
    return { success: false, error: "Encrypted database backup archive was not downloaded." };
  }

  const decryptedPath = join(localPath, "decrypted");
  await mkdir(decryptedPath, { recursive: true });
  const extracted = await extractArchiveToDirectory(ctx, archivePath, decryptedPath, signal);
  if (!extracted.success) {
    return {
      success: false,
      error: extracted.error ?? "Encrypted database backup could not be decrypted."
    };
  }
  return { success: true, path: decryptedPath };
}

async function extractUnencryptedArchive(
  archivePath: string,
  outputPath: string,
  signal?: AbortSignal
): Promise<void> {
  const lower = archivePath.toLowerCase();
  if (lower.endsWith(".tar.zst")) {
    await runRestoreCommand("tar", ["-I", "zstd", "-xf", archivePath, "-C", outputPath], signal);
  } else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    await runRestoreCommand("tar", ["-xzf", archivePath, "-C", outputPath], signal);
  } else if (lower.endsWith(".tar")) {
    await runRestoreCommand("tar", ["-xf", archivePath, "-C", outputPath], signal);
  } else if (lower.endsWith(".7z") || lower.endsWith(".zip")) {
    await runRestoreCommand("7z", ["x", `-o${outputPath}`, "-y", archivePath], signal);
  }
}

function runRestoreCommand(
  command: string,
  args: string[],
  signal?: AbortSignal,
  password?: string
): Promise<void> {
  return runCancellableLocalCommand(command, args, {
    description: `${command} failed while restoring an archive`,
    timeoutMs: 300_000,
    signal,
    redact: (value) => (password ? value.replaceAll(password, "[redacted]") : value)
  });
}

async function pathExists(path: string): Promise<boolean> {
  return stat(path)
    .then(() => true)
    .catch(() => false);
}

function throwIfCancelled(signal?: AbortSignal): void {
  if (signal?.aborted) {
    throw signal.reason instanceof Error ? signal.reason : new Error("Restore was cancelled.");
  }
}

function findRestoreArchive(root: string): string | null {
  return (
    findFiles(root).find((file) => {
      const lower = file.toLowerCase();
      return ARCHIVE_SUFFIXES.some((suffix) => lower.endsWith(suffix));
    }) ?? null
  );
}

export const restoreExecutionTestHooks = {
  prepareDatabaseRestorePath,
  prepareRemoteVolumeArchive
};
