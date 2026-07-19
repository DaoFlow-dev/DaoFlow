import { tmpdir } from "node:os";
import { join } from "node:path";

export const DEFAULT_RCLONE_REMOTE_NAME = "daoflow";
export const ENCRYPTED_RCLONE_REMOTE_NAME = "daoflow-crypt";
export const DEFAULT_LOCAL_RCLONE_PATH = join(tmpdir(), "daoflow-backups");

export interface RcloneRemoteDestination {
  provider: string;
  bucket?: string | null;
  localPath?: string | null;
  rcloneConfig?: string | null;
  rcloneRemotePath?: string | null;
  encryptionMode?: string | null;
  encryptionPassword?: string | null;
}

interface ExecutableErrorShape {
  code?: string;
  message?: string;
}

export function extractConfiguredRemoteName(config: string | null | undefined): string | null {
  if (!config) {
    return null;
  }

  const match = /^\s*\[([^\]\r\n]+)\]\s*$/m.exec(config);
  const remoteName = match?.[1]?.trim();
  return remoteName && remoteName.length > 0 ? remoteName : null;
}

export function resolveConfiguredRemoteName(
  dest: Pick<RcloneRemoteDestination, "provider" | "rcloneConfig">
): string {
  if (dest.provider !== "rclone" && !(dest.provider === "sftp" && dest.rcloneConfig)) {
    return DEFAULT_RCLONE_REMOTE_NAME;
  }

  return extractConfiguredRemoteName(dest.rcloneConfig) ?? DEFAULT_RCLONE_REMOTE_NAME;
}

function joinRemotePath(base: string, subPath?: string): string {
  if (!subPath) {
    return base;
  }

  return base.endsWith("/") ? `${base}${subPath}` : `${base}/${subPath}`;
}

export function resolveRemotePath(
  dest: RcloneRemoteDestination,
  subPath?: string,
  useEncrypted = false
): string {
  if (useEncrypted && dest.encryptionMode === "rclone-crypt" && dest.encryptionPassword) {
    return subPath
      ? `${ENCRYPTED_RCLONE_REMOTE_NAME}:${subPath}`
      : `${ENCRYPTED_RCLONE_REMOTE_NAME}:`;
  }

  const remoteName = resolveConfiguredRemoteName(dest);
  const base =
    dest.provider === "s3"
      ? `${remoteName}:${dest.bucket ?? ""}`
      : dest.provider === "local"
        ? `${remoteName}:${dest.localPath ?? DEFAULT_LOCAL_RCLONE_PATH}`
        : `${remoteName}:${dest.rcloneRemotePath ?? ""}`;

  return joinRemotePath(base, subPath);
}

export function parseRcloneLsOutput(output: string): {
  fileCount: number;
  totalBytes: number;
} {
  let fileCount = 0;
  let totalBytes = 0;

  for (const line of output.split("\n")) {
    const match = /^\s*(\d+)\s/.exec(line.trim());
    if (!match) {
      continue;
    }

    fileCount += 1;
    totalBytes += parseInt(match[1], 10);
  }

  return { fileCount, totalBytes };
}

function formatExecutableHelp(executable: string, action: string): string {
  return `Executable not found in $PATH: "${executable}". Install ${executable} in the current runtime before ${action}.`;
}

function looksLikeMissingExecutable(
  executable: string,
  message: string | undefined,
  code: string | undefined
): boolean {
  if (code === "ENOENT") {
    return true;
  }

  const normalized = message?.toLowerCase() ?? "";
  if (normalized.length === 0) {
    return false;
  }

  return (
    normalized.includes(`executable not found in $path: "${executable.toLowerCase()}"`) ||
    normalized.includes(`spawnsync ${executable.toLowerCase()} enoent`) ||
    normalized.includes(`spawn ${executable.toLowerCase()} enoent`) ||
    normalized.includes(`${executable.toLowerCase()}: not found`)
  );
}

export function normalizeExecutableFailure(
  executable: string,
  error: unknown,
  action: string
): string | null {
  const candidate = error as ExecutableErrorShape;
  const message = candidate?.message ?? (error instanceof Error ? error.message : String(error));

  if (!looksLikeMissingExecutable(executable, message, candidate?.code)) {
    return null;
  }

  return formatExecutableHelp(executable, action);
}
