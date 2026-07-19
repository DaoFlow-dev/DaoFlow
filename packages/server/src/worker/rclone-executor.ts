/**
 * rclone-executor.ts — Rclone operations for backup destinations.
 *
 * Runs rclone commands against temporary per-operation configs and cleans up.
 * Config generation and archive encryption live in focused helper modules.
 *
 * Design:
 * - Config is generated per-operation into a temp file (never persisted long-term)
 * - All operations respect --timeout and --retries for reliability
 */

import type { ExecFileSyncOptions } from "node:child_process";
import { unlinkSync } from "node:fs";
import { redactDestinationCredentialValues } from "../db/services/destination-credentials";
import {
  normalizeExecutableFailure,
  parseRcloneLsOutput,
  resolveRemotePath
} from "./rclone-helpers";
import { processRunner } from "./process-runner";
import { generateRcloneConfig, type DestinationConfig } from "./rclone-config";
import { getRcloneCommandTimeoutMs, type RcloneResult } from "./rclone-recovery-executor";

export { archiveDecrypt, archiveEncrypt, type ArchiveEncryptResult } from "./rclone-archive";
export { generateRcloneConfig, type DestinationConfig } from "./rclone-config";
export {
  copyObjectFromRemote,
  copyObjectFromRemoteAsync,
  copyFromRemoteAsync,
  copyObjectToRemote,
  copyObjectToRemoteAsync,
  copyToRemoteAsync,
  DEFAULT_RCLONE_COMMAND_TIMEOUT_MS,
  getRcloneCommandTimeoutMs,
  MAX_RCLONE_COMMAND_TIMEOUT_MS,
  MIN_RCLONE_COMMAND_TIMEOUT_MS,
  listRemoteAsync,
  type RcloneExecutionOptions,
  type RcloneResult
} from "./rclone-recovery-executor";

const DEFAULT_TIMEOUT = "30s";
const DEFAULT_RETRIES = "2";

function runRclone(dest: DestinationConfig, configPath: string, args: string[]): RcloneResult {
  const rcloneArgs = [`--config=${configPath}`, ...args];
  const opts: ExecFileSyncOptions = {
    timeout: getRcloneCommandTimeoutMs(),
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"]
  };

  try {
    const output = processRunner.execFileSync("rclone", rcloneArgs, opts) as unknown as string;
    return {
      success: true,
      output: redactDestinationCredentialValues(output ?? "", dest),
      exitCode: 0
    };
  } catch (err) {
    return rcloneFailure(dest, err);
  }
}

function rcloneFailure(
  dest: DestinationConfig,
  failure: unknown,
  stdout = "",
  stderr = ""
): RcloneResult {
  const error = failure as { status?: number; stdout?: string; stderr?: string; message?: string };
  const rawError =
    normalizeExecutableFailure("rclone", failure, "running backup destination operations") ??
    (stderr || error.stderr || error.message || String(failure));
  return {
    success: false,
    output: redactDestinationCredentialValues(stdout || error.stdout || "", dest),
    error: redactDestinationCredentialValues(rawError, dest),
    exitCode: error.status ?? 1
  };
}

function cleanupConfig(configPath: string): void {
  try {
    unlinkSync(configPath);
  } catch {
    /* best-effort cleanup */
  }
}

function withRcloneConfig<T>(dest: DestinationConfig, fn: (configPath: string) => T): T {
  const configPath = generateRcloneConfig(dest);
  try {
    return fn(configPath);
  } finally {
    cleanupConfig(configPath);
  }
}

// ── Public API ───────────────────────────────────────────────

/**
 * Test connection to a destination — runs `rclone lsd` with short timeout.
 */
export function testConnection(dest: DestinationConfig): RcloneResult {
  return withRcloneConfig(dest, (configPath) => {
    const remotePath = resolveRemotePath(dest);
    return runRclone(dest, configPath, [
      "lsd",
      remotePath,
      `--timeout=${DEFAULT_TIMEOUT}`,
      `--retries=${DEFAULT_RETRIES}`,
      "--low-level-retries=1",
      "--contimeout=5s"
    ]);
  });
}

/**
 * Copy a local file or directory to the remote destination.
 * Automatically routes through rclone-crypt when encryption is enabled.
 */
export function copyToRemote(
  dest: DestinationConfig,
  localPath: string,
  remoteSubPath: string
): RcloneResult {
  return withRcloneConfig(dest, (configPath) => {
    const useCrypt = dest.encryptionMode === "rclone-crypt";
    const remotePath = resolveRemotePath(dest, remoteSubPath, useCrypt);
    return runRclone(dest, configPath, [
      "copy",
      localPath,
      remotePath,
      `--timeout=${DEFAULT_TIMEOUT}`,
      `--retries=${DEFAULT_RETRIES}`,
      "--progress=false"
    ]);
  });
}

/**
 * Copy from remote to local — used for restore download.
 * Automatically routes through rclone-crypt when encryption is enabled.
 */
export function copyFromRemote(
  dest: DestinationConfig,
  remoteSubPath: string,
  localPath: string
): RcloneResult {
  return withRcloneConfig(dest, (configPath) => {
    const useCrypt = dest.encryptionMode === "rclone-crypt";
    const remotePath = resolveRemotePath(dest, remoteSubPath, useCrypt);
    return runRclone(dest, configPath, [
      "copy",
      remotePath,
      localPath,
      `--timeout=${DEFAULT_TIMEOUT}`,
      `--retries=${DEFAULT_RETRIES}`,
      "--progress=false"
    ]);
  });
}

/**
 * List files at a remote path — used for browsing backup artifacts.
 * Automatically routes through rclone-crypt when encryption is enabled.
 */
export function listRemote(dest: DestinationConfig, subPath?: string): RcloneResult {
  return withRcloneConfig(dest, (configPath) => {
    const useCrypt = dest.encryptionMode === "rclone-crypt";
    const remotePath = resolveRemotePath(dest, subPath, useCrypt);
    return runRclone(dest, configPath, [
      "ls",
      remotePath,
      `--timeout=${DEFAULT_TIMEOUT}`,
      `--retries=${DEFAULT_RETRIES}`
    ]);
  });
}

export interface RemoteFileEntry {
  name: string;
  size: number;
  isDir: boolean;
  modTime: string;
  path: string;
}

/**
 * List files at a remote path using `rclone lsjson` for structured output.
 * Returns parsed entries with name, size, isDir, and modTime.
 */
export function listRemoteJson(
  dest: DestinationConfig,
  subPath?: string
): { success: boolean; files: RemoteFileEntry[]; error?: string } {
  return withRcloneConfig(dest, (configPath) => {
    const useCrypt = dest.encryptionMode === "rclone-crypt";
    const remotePath = resolveRemotePath(dest, subPath, useCrypt);
    const result = runRclone(dest, configPath, [
      "lsjson",
      remotePath,
      `--timeout=${DEFAULT_TIMEOUT}`,
      `--retries=${DEFAULT_RETRIES}`,
      "--no-mimetype"
    ]);

    if (!result.success) {
      return { success: false, files: [], error: result.error ?? result.output };
    }

    try {
      const entries = JSON.parse(result.output || "[]") as Array<{
        Path: string;
        Name: string;
        Size: number;
        IsDir: boolean;
        ModTime: string;
      }>;
      return {
        success: true,
        files: entries.map((e) => ({
          name: e.Name,
          size: e.Size,
          isDir: e.IsDir,
          modTime: e.ModTime,
          path: e.Path
        }))
      };
    } catch {
      return { success: true, files: [] };
    }
  });
}

/**
 * Delete a remote path — used for retention cleanup.
 * Automatically routes through rclone-crypt when encryption is enabled.
 */
export function deleteRemote(dest: DestinationConfig, subPath: string): RcloneResult {
  return withRcloneConfig(dest, (configPath) => {
    const useCrypt = dest.encryptionMode === "rclone-crypt";
    const remotePath = resolveRemotePath(dest, subPath, useCrypt);
    return runRclone(dest, configPath, [
      "purge",
      remotePath,
      `--timeout=${DEFAULT_TIMEOUT}`,
      `--retries=${DEFAULT_RETRIES}`
    ]);
  });
}

/**
 * Verify backup integrity by listing remote and counting files.
 * Returns success if at least one file exists at the remote path.
 * For full integrity, compare file count and total size.
 */
export function checkRemote(
  dest: DestinationConfig,
  subPath: string
): { success: boolean; fileCount: number; totalBytes: number; error?: string } {
  return withRcloneConfig(dest, (configPath) => {
    const useCrypt = dest.encryptionMode === "rclone-crypt";
    const remotePath = resolveRemotePath(dest, subPath, useCrypt);
    const result = runRclone(dest, configPath, [
      "ls",
      remotePath,
      `--timeout=${DEFAULT_TIMEOUT}`,
      `--retries=${DEFAULT_RETRIES}`
    ]);

    if (!result.success) {
      return { success: false, fileCount: 0, totalBytes: 0, error: result.error ?? result.output };
    }

    const { fileCount, totalBytes } = parseRcloneLsOutput(result.output);

    return {
      success: fileCount > 0,
      fileCount,
      totalBytes,
      error: fileCount === 0 ? "No files found at remote path" : undefined
    };
  });
}
