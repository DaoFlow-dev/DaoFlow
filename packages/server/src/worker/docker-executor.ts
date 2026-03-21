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
import { existsSync, mkdirSync } from "node:fs";
import { parseComposePsOutput, type ComposeContainerStatus } from "./compose-health";
import { formatComposeExecutionEnvSummary, prepareComposeCommandEnv } from "./compose-command-env";
import { dockerCommand, withCommandPath } from "./command-env";

// Re-export git-executor functions for backward compatibility
export {
  ensureStagingDir,
  getStagingArchivePath,
  cleanupStagingDir,
  gitClone,
  prepareClonedRepository,
  type GitCloneOptions
} from "./git-executor";
export { buildComposeCommandEnv } from "./compose-command-env";

const STAGING_DIR = process.env.GIT_WORK_DIR ?? "/tmp/daoflow-staging";
const COMPOSE_BUILD_ENV = {
  DOCKER_BUILDKIT: "1",
  COMPOSE_DOCKER_CLI_BUILD: "1"
} as const;

export type LogLine = {
  stream: "stdout" | "stderr";
  message: string;
  timestamp: Date;
};

export type OnLog = (line: LogLine) => void;
type ExecRunner = typeof execStreaming;

export interface ExecStreamingOptions {
  inheritParentEnv?: boolean;
}

/**
 * Run an arbitrary command and stream output line-by-line.
 * Returns the exit code (0 = success).
 */
export function execStreaming(
  command: string,
  args: string[],
  cwd: string,
  onLog: OnLog,
  envOverrides?: Record<string, string>,
  options?: ExecStreamingOptions
): Promise<{ exitCode: number; signal: string | null }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      if (cwd === STAGING_DIR && !existsSync(cwd)) {
        mkdirSync(cwd, { recursive: true });
      }
      const env =
        options?.inheritParentEnv === false
          ? (envOverrides ?? {})
          : { ...process.env, DOCKER_CLI_HINTS: "false", ...(envOverrides ?? {}) };
      child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: withCommandPath(env)
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

  return execStreaming(dockerCommand, ["build", "-t", tag, "-f", dockerfile, "."], context, onLog);
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
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: scopedServiceName
      ? `Pulling images for compose project ${projectName} (service: ${scopedServiceName})`
      : `Pulling images for compose project ${projectName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  const args = ["compose", "-f", composeFile, "-p", projectName];
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("pull", "--ignore-buildable");
  if (scopedServiceName) {
    args.push("--include-deps");
    args.push(scopedServiceName);
  }

  return execRunner(dockerCommand, args, cwd, onLog, composeExecutionEnv.env, {
    inheritParentEnv: false
  });
}

export async function dockerComposeBuild(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeServiceName?: string,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const scopedServiceName = composeServiceName?.trim();
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: scopedServiceName
      ? `Building compose project ${projectName} (service: ${scopedServiceName})`
      : `Building compose project ${projectName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  const args = ["compose", "-f", composeFile, "-p", projectName];
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("build");
  if (scopedServiceName) {
    args.push("--with-dependencies");
    args.push(scopedServiceName);
  }

  return execRunner(
    dockerCommand,
    args,
    cwd,
    onLog,
    { ...composeExecutionEnv.env, ...COMPOSE_BUILD_ENV },
    {
      inheritParentEnv: false
    }
  );
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
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: scopedServiceName
      ? `Starting compose project ${projectName} (service: ${scopedServiceName})`
      : `Starting compose project ${projectName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
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

  return execRunner(dockerCommand, args, cwd, onLog, composeExecutionEnv.env, {
    inheritParentEnv: false
  });
}

export async function dockerComposePs(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  composeServiceName?: string,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number; statuses: ComposeContainerStatus[] }> {
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  const args = ["compose", "-f", composeFile, "-p", projectName];
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("ps", "--format", "json");

  const scopedServiceName = composeServiceName?.trim();
  if (scopedServiceName) {
    args.push(scopedServiceName);
  }

  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  const stdoutLines: string[] = [];
  const result = await execRunner(
    dockerCommand,
    args,
    cwd,
    (line) => {
      if (line.stream === "stdout") {
        stdoutLines.push(line.message);
        return;
      }

      onLog(line);
    },
    composeExecutionEnv.env,
    { inheritParentEnv: false }
  );

  return {
    exitCode: result.exitCode,
    statuses: result.exitCode === 0 ? parseComposePsOutput(stdoutLines.join("\n")) : []
  };
}

/**
 * Stop and remove services with docker compose down.
 */
export async function dockerComposeDown(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string,
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number }> {
  const composeExecutionEnv = prepareComposeCommandEnv(cwd, envFile);
  onLog({
    stream: "stdout",
    message: `Stopping compose project ${projectName}`,
    timestamp: new Date()
  });
  onLog({
    stream: "stdout",
    message: formatComposeExecutionEnvSummary(composeExecutionEnv.summary),
    timestamp: new Date()
  });

  return execRunner(
    dockerCommand,
    envFile
      ? ["compose", "-f", composeFile, "-p", projectName, "--env-file", envFile, "down"]
      : ["compose", "-f", composeFile, "-p", projectName, "down"],
    cwd,
    onLog,
    composeExecutionEnv.env,
    { inheritParentEnv: false }
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

  return execStreaming(dockerCommand, args, STAGING_DIR, onLog);
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

  return execStreaming(dockerCommand, ["pull", tag], STAGING_DIR, onLog);
}

/**
 * Check if a container is running and healthy.
 * Returns true if the container is in "running" state.
 */
export async function checkContainerHealth(containerName: string, onLog: OnLog): Promise<boolean> {
  let healthy = false;

  const result = await execStreaming(
    dockerCommand,
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
  await execStreaming(dockerCommand, ["stop", containerName], STAGING_DIR, onLog);
  return execStreaming(dockerCommand, ["rm", "-f", containerName], STAGING_DIR, onLog);
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

  return execStreaming(dockerCommand, ["load", "-i", tarPath], STAGING_DIR, onLog);
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
    dockerCommand,
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
    dockerCommand,
    ["version", "--format", "{{.Server.Version}}"],
    STAGING_DIR,
    (line) => {
      onLog(line);
      if (line.stream === "stdout" && line.message.match(/^\d+\.\d+/)) {
        versions.docker = line.message.trim();
      }
    }
  );

  await execStreaming(dockerCommand, ["compose", "version", "--short"], STAGING_DIR, (line) => {
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
