import { execFile, type ExecFileOptions, type ExecFileSyncOptions } from "node:child_process";
import { unlinkSync } from "node:fs";

import { redactDestinationCredentialValues } from "../db/services/destination-credentials";
import { processRunner } from "./process-runner";
import { generateRcloneConfig, type DestinationConfig } from "./rclone-config";
import { normalizeExecutableFailure, resolveRemotePath } from "./rclone-helpers";

export interface RcloneResult {
  success: boolean;
  output: string;
  error?: string;
  exitCode: number;
}

export interface RcloneExecutionOptions {
  cancellationSignal?: AbortSignal;
}

const REMOTE_TIMEOUT = "30s";
const REMOTE_RETRIES = "2";
export const DEFAULT_RCLONE_COMMAND_TIMEOUT_MS = 30 * 60 * 1000;
export const MIN_RCLONE_COMMAND_TIMEOUT_MS = 60 * 1000;
export const MAX_RCLONE_COMMAND_TIMEOUT_MS = 60 * 60 * 1000;

export function getRcloneCommandTimeoutMs(env: NodeJS.ProcessEnv = process.env): number {
  const raw = env.DAOFLOW_RCLONE_COMMAND_TIMEOUT_MS?.trim();
  if (!raw) return DEFAULT_RCLONE_COMMAND_TIMEOUT_MS;

  const timeoutMs = Number(raw);
  if (
    !Number.isInteger(timeoutMs) ||
    timeoutMs < MIN_RCLONE_COMMAND_TIMEOUT_MS ||
    timeoutMs > MAX_RCLONE_COMMAND_TIMEOUT_MS
  ) {
    throw new Error(
      `DAOFLOW_RCLONE_COMMAND_TIMEOUT_MS must be an integer between ${MIN_RCLONE_COMMAND_TIMEOUT_MS} and ${MAX_RCLONE_COMMAND_TIMEOUT_MS}.`
    );
  }
  return timeoutMs;
}

function recoveryArgs(source: string, destination: string): string[] {
  return [
    "copyto",
    source,
    destination,
    `--timeout=${REMOTE_TIMEOUT}`,
    `--retries=${REMOTE_RETRIES}`,
    "--progress=false"
  ];
}

function copyArgs(source: string, destination: string): string[] {
  return [
    "copy",
    source,
    destination,
    `--timeout=${REMOTE_TIMEOUT}`,
    `--retries=${REMOTE_RETRIES}`,
    "--progress=false"
  ];
}

function runRclone(dest: DestinationConfig, configPath: string, args: string[]): RcloneResult {
  const options: ExecFileSyncOptions = {
    timeout: getRcloneCommandTimeoutMs(),
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"]
  };
  try {
    const output = processRunner.execFileSync(
      "rclone",
      [`--config=${configPath}`, ...args],
      options
    );
    return { success: true, output: safeOutput(output, dest), exitCode: 0 };
  } catch (error) {
    return rcloneFailure(dest, error);
  }
}

function runRcloneAsync(
  dest: DestinationConfig,
  configPath: string,
  args: string[],
  options: RcloneExecutionOptions
): Promise<RcloneResult> {
  if (options.cancellationSignal?.aborted) {
    return Promise.reject(cancellationReason(options.cancellationSignal));
  }
  const execOptions: ExecFileOptions = {
    timeout: getRcloneCommandTimeoutMs(),
    encoding: "utf-8",
    signal: options.cancellationSignal
  };
  return new Promise((resolve, reject) => {
    try {
      execFile(
        "rclone",
        [`--config=${configPath}`, ...args],
        execOptions,
        (error, stdout, stderr) => {
          if (options.cancellationSignal?.aborted) {
            reject(cancellationReason(options.cancellationSignal));
            return;
          }
          resolve(
            error
              ? rcloneFailure(dest, error, String(stdout ?? ""), String(stderr ?? ""))
              : { success: true, output: safeOutput(stdout, dest), exitCode: 0 }
          );
        }
      );
    } catch (error) {
      if (options.cancellationSignal?.aborted) {
        reject(cancellationReason(options.cancellationSignal));
        return;
      }
      resolve(rcloneFailure(dest, error));
    }
  });
}

function rcloneFailure(
  dest: DestinationConfig,
  failure: unknown,
  stdout = "",
  stderr = ""
): RcloneResult {
  const error = failure as { status?: number; stdout?: string; stderr?: string; message?: string };
  const rawError =
    normalizeExecutableFailure("rclone", failure, "transferring backup data") ??
    (stderr || error.stderr || error.message || String(failure));
  return {
    success: false,
    output: safeOutput(stdout || error.stdout, dest),
    error: redactDestinationCredentialValues(rawError, dest),
    exitCode: error.status ?? 1
  };
}

function safeOutput(output: unknown, dest: DestinationConfig): string {
  const text =
    typeof output === "string" ? output : Buffer.isBuffer(output) ? output.toString("utf8") : "";
  return redactDestinationCredentialValues(text, dest);
}

function cancellationReason(signal: AbortSignal): Error {
  return signal.reason instanceof Error
    ? signal.reason
    : new Error("Rclone operation was cancelled.");
}

function cleanupConfig(configPath: string): void {
  try {
    unlinkSync(configPath);
  } catch {
    // Best-effort cleanup.
  }
}

function withConfig<T>(dest: DestinationConfig, operation: (configPath: string) => T): T {
  const configPath = generateRcloneConfig(dest);
  try {
    return operation(configPath);
  } finally {
    cleanupConfig(configPath);
  }
}

async function withConfigAsync<T>(
  dest: DestinationConfig,
  operation: (configPath: string) => Promise<T>
): Promise<T> {
  const configPath = generateRcloneConfig(dest);
  try {
    return await operation(configPath);
  } finally {
    cleanupConfig(configPath);
  }
}

export function copyObjectToRemote(
  dest: DestinationConfig,
  localPath: string,
  remoteObjectPath: string
): RcloneResult {
  return withConfig(dest, (configPath) =>
    runRclone(
      dest,
      configPath,
      recoveryArgs(localPath, resolveRemotePath(dest, remoteObjectPath, false))
    )
  );
}

export function copyObjectFromRemote(
  dest: DestinationConfig,
  remoteObjectPath: string,
  localPath: string
): RcloneResult {
  return withConfig(dest, (configPath) =>
    runRclone(
      dest,
      configPath,
      recoveryArgs(resolveRemotePath(dest, remoteObjectPath, false), localPath)
    )
  );
}

export async function copyObjectToRemoteAsync(
  dest: DestinationConfig,
  localPath: string,
  remoteObjectPath: string,
  options: RcloneExecutionOptions = {}
): Promise<RcloneResult> {
  return withConfigAsync(dest, (configPath) =>
    runRcloneAsync(
      dest,
      configPath,
      recoveryArgs(localPath, resolveRemotePath(dest, remoteObjectPath, false)),
      options
    )
  );
}

export async function copyObjectFromRemoteAsync(
  dest: DestinationConfig,
  remoteObjectPath: string,
  localPath: string,
  options: RcloneExecutionOptions = {}
): Promise<RcloneResult> {
  return withConfigAsync(dest, (configPath) =>
    runRcloneAsync(
      dest,
      configPath,
      recoveryArgs(resolveRemotePath(dest, remoteObjectPath, false), localPath),
      options
    )
  );
}

export async function copyToRemoteAsync(
  dest: DestinationConfig,
  localPath: string,
  remoteSubPath: string,
  options: RcloneExecutionOptions = {}
): Promise<RcloneResult> {
  return withConfigAsync(dest, (configPath) =>
    runRcloneAsync(
      dest,
      configPath,
      copyArgs(
        localPath,
        resolveRemotePath(dest, remoteSubPath, dest.encryptionMode === "rclone-crypt")
      ),
      options
    )
  );
}

export async function copyFromRemoteAsync(
  dest: DestinationConfig,
  remoteSubPath: string,
  localPath: string,
  options: RcloneExecutionOptions = {}
): Promise<RcloneResult> {
  return withConfigAsync(dest, (configPath) =>
    runRcloneAsync(
      dest,
      configPath,
      copyArgs(
        resolveRemotePath(dest, remoteSubPath, dest.encryptionMode === "rclone-crypt"),
        localPath
      ),
      options
    )
  );
}

export async function listRemoteAsync(
  dest: DestinationConfig,
  subPath: string,
  options: RcloneExecutionOptions = {}
): Promise<RcloneResult> {
  return withConfigAsync(dest, (configPath) =>
    runRcloneAsync(
      dest,
      configPath,
      [
        "ls",
        resolveRemotePath(dest, subPath, dest.encryptionMode === "rclone-crypt"),
        `--timeout=${REMOTE_TIMEOUT}`,
        `--retries=${REMOTE_RETRIES}`
      ],
      options
    )
  );
}
