/**
 * docker-executor.ts
 *
 * Isolated module for running Docker / Docker Compose / git commands.
 * Each function streams output line-by-line through a callback so the
 * log-streamer can persist them in real time.
 *
 * This module never touches the database directly — it only runs
 * child processes and reports their output.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { parseComposeEnvFile } from "../compose-env";

// Re-export git-executor functions for backward compatibility
export {
  ensureStagingDir,
  getStagingArchivePath,
  cleanupStagingDir,
  gitClone,
  prepareClonedRepository,
  type GitCloneOptions
} from "./git-executor";

const STAGING_DIR = process.env.GIT_WORK_DIR ?? "/tmp/daoflow-staging";

export type LogLine = {
  stream: "stdout" | "stderr";
  message: string;
  timestamp: Date;
};

export type OnLog = (line: LogLine) => void;
type ExecRunner = typeof execStreaming;

const COMPOSE_ENV_ALLOWLIST = [
  "PATH",
  "HOME",
  "DOCKER_CONFIG",
  "DOCKER_HOST",
  "DOCKER_CONTEXT",
  "DOCKER_CERT_PATH",
  "DOCKER_TLS_VERIFY",
  "SSH_AUTH_SOCK",
  "XDG_RUNTIME_DIR",
  "TMPDIR",
  "LANG",
  "LC_ALL"
] as const;

/**
 * Run an arbitrary command and stream output line-by-line.
 * Returns the exit code (0 = success).
 */
export function execStreaming(
  command: string,
  args: string[],
  cwd: string,
  onLog: OnLog,
  envOverrides?: Record<string, string>
): Promise<{ exitCode: number; signal: string | null }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, DOCKER_CLI_HINTS: "false", ...(envOverrides ?? {}) }
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    const processStream = (stream: "stdout" | "stderr", data: Buffer) => {
      const text = data.toString("utf-8");
      for (const rawLine of text.split("\n")) {
        const message = rawLine.trimEnd();
        if (message.length > 0) {
          onLog({ stream, message, timestamp: new Date() });
        }
      }
    };

    child.stdout?.on("data", (data: Buffer) => processStream("stdout", data));
    child.stderr?.on("data", (data: Buffer) => processStream("stderr", data));

    child.on("close", (code, signal) => {
      resolve({ exitCode: code ?? 1, signal: signal ?? null });
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

export function buildComposeCommandEnv(cwd: string, envFile?: string): Record<string, string> {
  const env: Record<string, string> = { DOCKER_CLI_HINTS: "false" };

  for (const key of COMPOSE_ENV_ALLOWLIST) {
    const value = process.env[key];
    if (typeof value === "string" && value.length > 0) {
      env[key] = value;
    }
  }

  if (!envFile) {
    return env;
  }

  const envPath = join(cwd, envFile);
  if (!existsSync(envPath)) {
    return env;
  }

  for (const entry of parseComposeEnvFile(readFileSync(envPath, "utf8")).entries) {
    env[entry.key] = entry.value;
  }

  return env;
}

/**
 * Build a Docker image from a Dockerfile.
 */
export async function dockerBuild(
  context: string,
  dockerfile: string,
  tag: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Building image ${tag} from ${dockerfile}`,
    timestamp: new Date()
  });

  return execStreaming("docker", ["build", "-t", tag, "-f", dockerfile, "."], context, onLog);
}

/**
 * Pull images defined in a compose file.
 */
export async function dockerComposePull(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeServiceName?: string,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const scopedServiceName = composeServiceName?.trim();
  onLog({
    stream: "stdout",
    message: scopedServiceName
      ? `Pulling images for compose project ${projectName} (service: ${scopedServiceName})`
      : `Pulling images for compose project ${projectName}`,
    timestamp: new Date()
  });

  const args = ["compose", "-f", composeFile, "-p", projectName];
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("pull");
  if (scopedServiceName) {
    args.push(scopedServiceName);
  }

  return execRunner("docker", args, cwd, onLog, buildComposeCommandEnv(cwd, envFile));
}

/**
 * Deploy services with docker compose up.
 */
export async function dockerComposeUp(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeServiceName?: string,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const scopedServiceName = composeServiceName?.trim();
  onLog({
    stream: "stdout",
    message: scopedServiceName
      ? `Starting compose project ${projectName} (service: ${scopedServiceName})`
      : `Starting compose project ${projectName}`,
    timestamp: new Date()
  });

  const args = ["compose", "-f", composeFile, "-p", projectName];
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("up", "-d", "--remove-orphans");
  if (scopedServiceName) {
    args.push(scopedServiceName);
  }

  return execRunner("docker", args, cwd, onLog, buildComposeCommandEnv(cwd, envFile));
}

/**
 * Stop and remove services with docker compose down.
 */
export async function dockerComposeDown(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Stopping compose project ${projectName}`,
    timestamp: new Date()
  });

  return execStreaming(
    "docker",
    ["compose", "-f", composeFile, "-p", projectName, "down"],
    cwd,
    onLog
  );
}

/**
 * Deploy a single image-based container (non-compose path).
 */
export async function dockerRun(
  tag: string,
  containerName: string,
  options: { ports?: string[]; volumes?: string[]; env?: Record<string, string>; network?: string },
  onLog: OnLog
): Promise<{ exitCode: number }> {
  const args = ["run", "-d", "--name", containerName, "--restart", "unless-stopped"];

  if (options.network) {
    args.push("--network", options.network);
  }
  for (const port of options.ports ?? []) {
    args.push("-p", port);
  }
  for (const volume of options.volumes ?? []) {
    args.push("-v", volume);
  }
  for (const [key, value] of Object.entries(options.env ?? {})) {
    args.push("-e", `${key}=${value}`);
  }
  args.push(tag);

  onLog({
    stream: "stdout",
    message: `Running container ${containerName} from ${tag}`,
    timestamp: new Date()
  });

  return execStreaming("docker", args, STAGING_DIR, onLog);
}

/**
 * Pull a single Docker image.
 */
export async function dockerPull(tag: string, onLog: OnLog): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Pulling image ${tag}`,
    timestamp: new Date()
  });

  return execStreaming("docker", ["pull", tag], STAGING_DIR, onLog);
}

/**
 * Check if a container is running and healthy.
 * Returns true if the container is in "running" state.
 */
export async function checkContainerHealth(containerName: string, onLog: OnLog): Promise<boolean> {
  let healthy = false;

  const result = await execStreaming(
    "docker",
    ["inspect", "--format", "{{.State.Status}}", containerName],
    STAGING_DIR,
    (line) => {
      onLog(line);
      if (line.message.trim() === "running") {
        healthy = true;
      }
    }
  );

  return result.exitCode === 0 && healthy;
}

/**
 * Stop and remove a container by name.
 */
export async function dockerRemoveContainer(
  containerName: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Removing container ${containerName}`,
    timestamp: new Date()
  });

  // Stop first, then remove
  await execStreaming("docker", ["stop", containerName], STAGING_DIR, onLog);
  return execStreaming("docker", ["rm", "-f", containerName], STAGING_DIR, onLog);
}

/**
 * Load a Docker image from a tarball file.
 * Equivalent to `docker load -i <tarPath>`.
 */
export async function dockerLoad(tarPath: string, onLog: OnLog): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Loading image from ${tarPath}`,
    timestamp: new Date()
  });

  return execStreaming("docker", ["load", "-i", tarPath], STAGING_DIR, onLog);
}

/**
 * List Docker images and return structured JSON output.
 * Equivalent to `docker images --format json`.
 */
export async function dockerListImages(
  onLog: OnLog
): Promise<{ exitCode: number; images: DockerImageListEntry[] }> {
  let rawOutput = "";

  const result = await execStreaming(
    "docker",
    ["images", "--format", "json"],
    STAGING_DIR,
    (line) => {
      onLog(line);
      rawOutput += line.message + "\n";
    }
  );

  const images: DockerImageListEntry[] = rawOutput
    .trim()
    .split("\n")
    .filter(Boolean)
    .map((line) => {
      try {
        return JSON.parse(line) as DockerImageListEntry;
      } catch {
        return null;
      }
    })
    .filter((item): item is DockerImageListEntry => item !== null);

  return { exitCode: result.exitCode, images };
}

export async function detectLocalRuntimeVersions(
  onLog: OnLog
): Promise<{ docker?: string; compose?: string }> {
  const versions: { docker?: string; compose?: string } = {};

  await execStreaming(
    "docker",
    ["version", "--format", "{{.Server.Version}}"],
    STAGING_DIR,
    (line) => {
      onLog(line);
      if (line.stream === "stdout" && line.message.match(/^\d+\.\d+/)) {
        versions.docker = line.message.trim();
      }
    }
  );

  await execStreaming("docker", ["compose", "version", "--short"], STAGING_DIR, (line) => {
    onLog(line);
    if (line.stream === "stdout" && line.message.match(/^\d+\.\d+/)) {
      versions.compose = line.message.trim();
    }
  });

  return versions;
}

export async function extractTarArchive(
  tarPath: string,
  destinationDir: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Extracting ${tarPath} into ${destinationDir}`,
    timestamp: new Date()
  });

  return execStreaming("tar", ["-xzf", tarPath, "-C", destinationDir], STAGING_DIR, onLog);
}

export async function createTarArchive(
  sourceDir: string,
  tarPath: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Archiving ${sourceDir} into ${tarPath}`,
    timestamp: new Date()
  });

  return execStreaming("tar", ["-czf", tarPath, "-C", sourceDir, "."], STAGING_DIR, onLog);
}

export interface DockerImageListEntry {
  Repository: string;
  Tag: string;
  ID: string;
  CreatedAt: string;
  Size: string;
}
