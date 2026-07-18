import { existsSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { processRunner } from "../../process-runner";
import { archiveDecrypt } from "../../rclone-archive";
import type { DestinationConfig } from "../../rclone-executor";
import type { RestoreResolved } from "./restore-activities";
import { executeDatabaseRestore } from "./restore-database";
import { byteSizeOfPath, findFiles } from "./restore-files";

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
  localPath: string
): Promise<RestoreExecutionResult> {
  if (ctx.backupType === "database") {
    const prepared = prepareDatabaseRestorePath(ctx, localPath);
    if (!prepared.success) {
      return { success: false, bytesRestored: 0, error: prepared.error };
    }
    return executeDatabaseRestore(ctx, prepared.path);
  }

  return executeVolumeRestore(ctx, localPath);
}

function executeVolumeRestore(
  ctx: RestoreExecutionContext,
  localPath: string
): RestoreExecutionResult {
  try {
    if (!existsSync(localPath)) {
      return { success: false, bytesRestored: 0, error: `Downloaded path ${localPath} is missing` };
    }

    mkdirSync(ctx.targetPath, { recursive: true });
    const archive = findRestoreArchive(localPath);

    if (archive) {
      const extracted = extractArchiveToDirectory(ctx, archive, ctx.targetPath);
      if (!extracted.success) {
        return extracted;
      }
    }

    const bytesRestored = byteSizeOfPath(ctx.targetPath);
    return { success: true, bytesRestored };
  } catch (err) {
    return {
      success: false,
      bytesRestored: 0,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

function extractArchiveToDirectory(
  ctx: RestoreExecutionContext,
  archivePath: string,
  outputPath: string
): RestoreExecutionResult {
  if (ctx.encryptionMode === "archive-7z" || ctx.encryptionMode === "archive-zip") {
    const password = ctx.destination.encryptionPassword;
    if (!password) {
      return {
        success: false,
        bytesRestored: 0,
        error: "Encrypted archive restore requires a destination encryption password."
      };
    }
    const decrypted = archiveDecrypt(archivePath, password, outputPath);
    return {
      success: decrypted.success,
      bytesRestored: byteSizeOfPath(outputPath),
      error: decrypted.error
    };
  }

  const lower = archivePath.toLowerCase();
  if (lower.endsWith(".tar.zst")) {
    processRunner.execFileSync("tar", ["-I", "zstd", "-xf", archivePath, "-C", outputPath], {
      timeout: 300_000,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } else if (lower.endsWith(".tar.gz") || lower.endsWith(".tgz")) {
    processRunner.execFileSync("tar", ["-xzf", archivePath, "-C", outputPath], {
      timeout: 300_000,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } else if (lower.endsWith(".tar")) {
    processRunner.execFileSync("tar", ["-xf", archivePath, "-C", outputPath], {
      timeout: 300_000,
      stdio: ["pipe", "pipe", "pipe"]
    });
  } else if (lower.endsWith(".7z") || lower.endsWith(".zip")) {
    processRunner.execFileSync("7z", ["x", `-o${outputPath}`, "-y", archivePath], {
      timeout: 300_000,
      stdio: ["pipe", "pipe", "pipe"]
    });
  }

  return { success: true, bytesRestored: byteSizeOfPath(outputPath) };
}

function prepareDatabaseRestorePath(
  ctx: RestoreExecutionContext,
  localPath: string
): { success: true; path: string } | { success: false; error: string } {
  if (ctx.encryptionMode !== "archive-7z" && ctx.encryptionMode !== "archive-zip") {
    return { success: true, path: localPath };
  }

  const archivePath = findRestoreArchive(localPath);
  if (!archivePath) {
    return { success: false, error: "Encrypted database backup archive was not downloaded." };
  }

  const decryptedPath = join(localPath, "decrypted");
  mkdirSync(decryptedPath, { recursive: true });
  const extracted = extractArchiveToDirectory(ctx, archivePath, decryptedPath);
  if (!extracted.success) {
    return {
      success: false,
      error: extracted.error ?? "Encrypted database backup could not be decrypted."
    };
  }
  return { success: true, path: decryptedPath };
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
  prepareDatabaseRestorePath
};
