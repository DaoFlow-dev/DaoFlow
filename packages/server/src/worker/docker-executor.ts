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
import { existsSync, mkdirSync, rmSync } from "node:fs";
import { join } from "node:path";

const STAGING_DIR = process.env.GIT_WORK_DIR ?? "/app/staging";

export type LogLine = {
  stream: "stdout" | "stderr";
  message: string;
  timestamp: Date;
};

export type OnLog = (line: LogLine) => void;

/**
 * Run an arbitrary command and stream output line-by-line.
 * Returns the exit code (0 = success).
 */
export function execStreaming(
  command: string,
  args: string[],
  cwd: string,
  onLog: OnLog
): Promise<{ exitCode: number; signal: string | null }> {
  return new Promise((resolve, reject) => {
    let child: ChildProcess;
    try {
      child = spawn(command, args, {
        cwd,
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env, DOCKER_CLI_HINTS: "false" }
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
 * Ensure the staging directory for a deployment exists.
 */
export function ensureStagingDir(deploymentId: string): string {
  const dir = join(STAGING_DIR, deploymentId);
  if (!existsSync(dir)) {
    mkdirSync(dir, { recursive: true });
  }
  return dir;
}

/**
 * Clean up staging directory after deployment.
 */
export function cleanupStagingDir(deploymentId: string): void {
  const dir = join(STAGING_DIR, deploymentId);
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
  } catch {
    /* best effort cleanup */
  }
}

/**
 * Clone a git repository into the staging directory.
 */
export async function gitClone(
  repoUrl: string,
  branch: string,
  deploymentId: string,
  onLog: OnLog
): Promise<{ exitCode: number; workDir: string }> {
  const workDir = ensureStagingDir(deploymentId);

  onLog({
    stream: "stdout",
    message: `Cloning ${repoUrl} (branch: ${branch}) into ${workDir}`,
    timestamp: new Date()
  });

  const result = await execStreaming(
    "git",
    ["clone", "--depth", "1", "--branch", branch, "--single-branch", repoUrl, "."],
    workDir,
    onLog
  );

  return { exitCode: result.exitCode, workDir };
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
  onLog: OnLog
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Pulling images for compose project ${projectName}`,
    timestamp: new Date()
  });

  return execStreaming(
    "docker",
    ["compose", "-f", composeFile, "-p", projectName, "pull"],
    cwd,
    onLog
  );
}

/**
 * Deploy services with docker compose up.
 */
export async function dockerComposeUp(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Starting compose project ${projectName}`,
    timestamp: new Date()
  });

  return execStreaming(
    "docker",
    ["compose", "-f", composeFile, "-p", projectName, "up", "-d", "--remove-orphans"],
    cwd,
    onLog
  );
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
