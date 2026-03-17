/**
 * rclone-executor.ts — Rclone operations for backup destinations.
 *
 * Generates temporary rclone config files per-operation, runs rclone commands,
 * and cleans up. Supports S3-compatible, Google Drive, OneDrive, Dropbox,
 * SFTP, local filesystem, and custom rclone configs.
 *
 * Design:
 * - Config is generated per-operation into a temp file (never persisted long-term)
 * - S3 backends use inline --s3-* flags (like Dokploy) for simplicity
 * - OAuth backends use --config with token embedded
 * - Local backend uses [local] type for E2E testing
 * - All operations respect --timeout and --retries for reliability
 */

import { execFileSync, type ExecFileSyncOptions } from "node:child_process";
import { writeFileSync, appendFileSync, unlinkSync, mkdirSync, existsSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { randomBytes } from "node:crypto";
import type { BackupProvider } from "../db/schema/destinations";

// ── Types ────────────────────────────────────────────────────

export interface DestinationConfig {
  id: string;
  provider: BackupProvider;
  // S3 fields
  accessKey?: string | null;
  secretAccessKey?: string | null;
  bucket?: string | null;
  region?: string | null;
  endpoint?: string | null;
  s3Provider?: string | null;
  // Rclone fields
  rcloneType?: string | null;
  rcloneConfig?: string | null;
  rcloneRemotePath?: string | null;
  // OAuth
  oauthToken?: string | null;
  // Encryption
  encryptionMode?: string | null; // "none" | "rclone-crypt" | "archive-7z" | "archive-zip"
  encryptionPassword?: string | null;
  encryptionSalt?: string | null;
  filenameEncryption?: string | null; // "standard" | "obfuscate" | "off"
  // Local
  localPath?: string | null;
}

export interface RcloneResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
}

// ── Config Generation ────────────────────────────────────────

const REMOTE_NAME = "daoflow";
const ENCRYPTED_REMOTE_NAME = "daoflow-crypt";

/**
 * Obscure a password for rclone crypt config.
 * Rclone uses a specific obscuring algorithm — for safety we
 * call `rclone obscure` to generate the value.
 */
function obscurePassword(password: string): string {
  try {
    const result = execFileSync("rclone", ["obscure", password], {
      encoding: "utf-8",
      timeout: 10_000
    }) as unknown as string;
    return (result ?? "").trim();
  } catch {
    // If rclone is not installed or obscure fails, use raw password
    // (rclone still accepts plain-text passwords but warns)
    return password;
  }
}

/**
 * Generate a temp rclone.conf file for the given destination.
 * Returns the path to the temp config file.
 */
export function generateRcloneConfig(dest: DestinationConfig): string {
  const configPath = join(
    tmpdir(),
    `daoflow-rclone-${dest.id}-${randomBytes(8).toString("hex")}.conf`
  );
  let configContent = "";

  switch (dest.provider) {
    case "s3":
      configContent = buildS3Config(dest);
      break;
    case "gdrive":
      configContent = buildOAuthConfig("drive", dest);
      break;
    case "onedrive":
      configContent = buildOAuthConfig("onedrive", dest);
      break;
    case "dropbox":
      configContent = buildOAuthConfig("dropbox", dest);
      break;
    case "sftp":
      configContent = buildSftpConfig(dest);
      break;
    case "local":
      configContent = buildLocalConfig(dest);
      break;
    case "rclone":
      // Custom rclone config — use as-is (already in INI format)
      configContent = dest.rcloneConfig ?? "";
      break;
    default:
      throw new Error(`Unsupported provider: ${String(dest.provider)}`);
  }

  writeFileSync(configPath, configContent, { mode: 0o600 });

  // If rclone-crypt encryption is enabled, append a nested crypt remote
  if (dest.encryptionMode === "rclone-crypt" && dest.encryptionPassword) {
    const cryptSection = buildCryptOverlay(dest);
    appendFileSync(configPath, cryptSection, { mode: 0o600 });
  }

  return configPath;
}

function buildS3Config(dest: DestinationConfig): string {
  const lines = [
    `[${REMOTE_NAME}]`,
    `type = s3`,
    dest.s3Provider ? `provider = ${dest.s3Provider}` : "",
    dest.accessKey ? `access_key_id = ${dest.accessKey}` : "",
    dest.secretAccessKey ? `secret_access_key = ${dest.secretAccessKey}` : "",
    dest.region ? `region = ${dest.region}` : "",
    dest.endpoint ? `endpoint = ${dest.endpoint}` : "",
    `force_path_style = true`,
    `no_check_bucket = true`
  ];
  return lines.filter(Boolean).join("\n") + "\n";
}

function buildOAuthConfig(rcloneType: string, dest: DestinationConfig): string {
  const lines = [
    `[${REMOTE_NAME}]`,
    `type = ${rcloneType}`,
    dest.oauthToken ? `token = ${dest.oauthToken}` : ""
  ];
  return lines.filter(Boolean).join("\n") + "\n";
}

function buildSftpConfig(dest: DestinationConfig): string {
  // For SFTP, expect rcloneConfig to contain host/user/key details
  if (dest.rcloneConfig) {
    return dest.rcloneConfig;
  }
  return `[${REMOTE_NAME}]\ntype = sftp\n`;
}

function buildLocalConfig(dest: DestinationConfig): string {
  // Ensure the local backup directory exists
  const localPath = dest.localPath ?? join(tmpdir(), "daoflow-backups");
  if (!existsSync(localPath)) {
    mkdirSync(localPath, { recursive: true });
  }
  return `[${REMOTE_NAME}]\ntype = local\n`;
}

/**
 * Build a rclone crypt overlay that wraps the base remote.
 * This gives transparent client-side encryption for any backend.
 *
 * Config result looks like:
 *   [daoflow-crypt]
 *   type = crypt
 *   remote = daoflow:bucket/path
 *   password = obscured_password
 *   password2 = obscured_salt
 *   filename_encryption = standard
 */
function buildCryptOverlay(dest: DestinationConfig): string {
  const baseRemote = resolveRemotePath(dest);
  const obscuredPw = obscurePassword(dest.encryptionPassword ?? "");
  const filenameEnc = dest.filenameEncryption ?? "standard";

  const lines = [
    `\n[${ENCRYPTED_REMOTE_NAME}]`,
    `type = crypt`,
    `remote = ${baseRemote}`,
    `password = ${obscuredPw}`,
    dest.encryptionSalt ? `password2 = ${obscurePassword(dest.encryptionSalt)}` : "",
    `filename_encryption = ${filenameEnc}`,
    `directory_name_encryption = true`
  ];
  return lines.filter(Boolean).join("\n") + "\n";
}

// ── Archive Encryption ───────────────────────────────────────

export interface ArchiveEncryptResult {
  archivePath: string;
  originalPath: string;
  success: boolean;
  error?: string;
}

/**
 * Encrypt a directory/file into a password-protected archive.
 * Supports 7z (AES-256) and zip (AES) formats.
 * Returns the path to the encrypted archive.
 */
export function archiveEncrypt(
  sourcePath: string,
  password: string,
  mode: "archive-7z" | "archive-zip" = "archive-7z"
): ArchiveEncryptResult {
  const ext = mode === "archive-7z" ? "7z" : "zip";
  const archivePath = join(tmpdir(), `daoflow-backup-${randomBytes(8).toString("hex")}.${ext}`);

  try {
    if (mode === "archive-7z") {
      // 7z with AES-256 encryption, encrypt headers too
      execFileSync(
        "7z",
        ["a", "-t7z", `-p${password}`, "-mhe=on", "-mx=5", archivePath, sourcePath],
        { timeout: 300_000, stdio: ["pipe", "pipe", "pipe"] }
      );
    } else {
      // zip with AES encryption via 7z
      execFileSync(
        "7z",
        ["a", "-tzip", `-p${password}`, "-mem=AES256", "-mx=5", archivePath, sourcePath],
        { timeout: 300_000, stdio: ["pipe", "pipe", "pipe"] }
      );
    }
    return { archivePath, originalPath: sourcePath, success: true };
  } catch (err) {
    return {
      archivePath,
      originalPath: sourcePath,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Decrypt an encrypted archive to a target directory.
 * Used for restore flows.
 */
export function archiveDecrypt(
  archivePath: string,
  password: string,
  outputDir: string
): ArchiveEncryptResult {
  if (!existsSync(outputDir)) {
    mkdirSync(outputDir, { recursive: true });
  }

  try {
    execFileSync("7z", ["x", `-p${password}`, `-o${outputDir}`, "-y", archivePath], {
      timeout: 300_000,
      stdio: ["pipe", "pipe", "pipe"]
    });
    return { archivePath, originalPath: outputDir, success: true };
  } catch (err) {
    return {
      archivePath,
      originalPath: outputDir,
      success: false,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

// ── Command Execution ────────────────────────────────────────

const DEFAULT_TIMEOUT = "30s";
const DEFAULT_RETRIES = "2";

function runRclone(configPath: string, args: string[]): RcloneResult {
  const rcloneArgs = [`--config=${configPath}`, ...args];
  const opts: ExecFileSyncOptions = {
    timeout: 60_000,
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"]
  };

  try {
    const output = execFileSync("rclone", rcloneArgs, opts) as unknown as string;
    return { success: true, output: output ?? "", exitCode: 0 };
  } catch (err) {
    const error = err as { status?: number; stdout?: string; stderr?: string };
    return {
      success: false,
      output: error.stdout ?? "",
      error: error.stderr ?? String(err),
      exitCode: error.status ?? 1
    };
  }
}

function cleanupConfig(configPath: string): void {
  try {
    unlinkSync(configPath);
  } catch {
    /* best-effort cleanup */
  }
}

// ── Public API ───────────────────────────────────────────────

/**
 * Resolve the remote path for rclone commands.
 * S3: "daoflow:bucket/path"
 * Local: "daoflow:/local/path"
 * Others: "daoflow:path"
 * When useEncrypted=true and dest has rclone-crypt, uses "daoflow-crypt:" prefix
 */
function resolveRemotePath(
  dest: DestinationConfig,
  subPath?: string,
  useEncrypted = false
): string {
  const remoteName =
    useEncrypted && dest.encryptionMode === "rclone-crypt" && dest.encryptionPassword
      ? ENCRYPTED_REMOTE_NAME
      : REMOTE_NAME;

  const base =
    dest.provider === "s3"
      ? `${remoteName}:${dest.bucket ?? ""}`
      : dest.provider === "local"
        ? `${remoteName}:${dest.localPath ?? join(tmpdir(), "daoflow-backups")}`
        : `${remoteName}:${dest.rcloneRemotePath ?? ""}`;

  // For crypt remotes, the path is relative to the crypt root (no bucket prefix)
  if (useEncrypted && dest.encryptionMode === "rclone-crypt" && dest.encryptionPassword) {
    const cryptBase = `${ENCRYPTED_REMOTE_NAME}:`;
    if (subPath) {
      return `${cryptBase}${subPath}`;
    }
    return cryptBase;
  }

  if (subPath) {
    return base.endsWith("/") ? `${base}${subPath}` : `${base}/${subPath}`;
  }
  return base;
}

/**
 * Test connection to a destination — runs `rclone lsd` with short timeout.
 */
export function testConnection(dest: DestinationConfig): RcloneResult {
  const configPath = generateRcloneConfig(dest);
  try {
    const remotePath = resolveRemotePath(dest);
    return runRclone(configPath, [
      "lsd",
      remotePath,
      `--timeout=${DEFAULT_TIMEOUT}`,
      `--retries=${DEFAULT_RETRIES}`,
      "--low-level-retries=1",
      "--contimeout=5s"
    ]);
  } finally {
    cleanupConfig(configPath);
  }
}

/**
 * Copy a local file or directory to the remote destination.
 * Automatically routes through rclone-crypt when encryption is enabled.
 */
export function copyToRemote(
  dest: DestinationConfig,
  localPath: string,
  remotSubPath: string
): RcloneResult {
  const configPath = generateRcloneConfig(dest);
  try {
    const useCrypt = dest.encryptionMode === "rclone-crypt";
    const remotePath = resolveRemotePath(dest, remotSubPath, useCrypt);
    return runRclone(configPath, [
      "copy",
      localPath,
      remotePath,
      `--timeout=${DEFAULT_TIMEOUT}`,
      `--retries=${DEFAULT_RETRIES}`,
      "--progress=false"
    ]);
  } finally {
    cleanupConfig(configPath);
  }
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
  const configPath = generateRcloneConfig(dest);
  try {
    const useCrypt = dest.encryptionMode === "rclone-crypt";
    const remotePath = resolveRemotePath(dest, remoteSubPath, useCrypt);
    return runRclone(configPath, [
      "copy",
      remotePath,
      localPath,
      `--timeout=${DEFAULT_TIMEOUT}`,
      `--retries=${DEFAULT_RETRIES}`,
      "--progress=false"
    ]);
  } finally {
    cleanupConfig(configPath);
  }
}

/**
 * List files at a remote path — used for browsing backup artifacts.
 * Automatically routes through rclone-crypt when encryption is enabled.
 */
export function listRemote(dest: DestinationConfig, subPath?: string): RcloneResult {
  const configPath = generateRcloneConfig(dest);
  try {
    const useCrypt = dest.encryptionMode === "rclone-crypt";
    const remotePath = resolveRemotePath(dest, subPath, useCrypt);
    return runRclone(configPath, [
      "ls",
      remotePath,
      `--timeout=${DEFAULT_TIMEOUT}`,
      `--retries=${DEFAULT_RETRIES}`
    ]);
  } finally {
    cleanupConfig(configPath);
  }
}

/**
 * Delete a remote path — used for retention cleanup.
 * Automatically routes through rclone-crypt when encryption is enabled.
 */
export function deleteRemote(dest: DestinationConfig, subPath: string): RcloneResult {
  const configPath = generateRcloneConfig(dest);
  try {
    const useCrypt = dest.encryptionMode === "rclone-crypt";
    const remotePath = resolveRemotePath(dest, subPath, useCrypt);
    return runRclone(configPath, [
      "purge",
      remotePath,
      `--timeout=${DEFAULT_TIMEOUT}`,
      `--retries=${DEFAULT_RETRIES}`
    ]);
  } finally {
    cleanupConfig(configPath);
  }
}
