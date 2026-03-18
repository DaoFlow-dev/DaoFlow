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
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { RepositoryPreparationConfig } from "../repository-preparation";

const STAGING_DIR = process.env.GIT_WORK_DIR ?? "/tmp/daoflow-staging";

export type LogLine = {
  stream: "stdout" | "stderr";
  message: string;
  timestamp: Date;
};

export type OnLog = (line: LogLine) => void;
type ExecRunner = typeof execStreaming;

export interface GitCloneOptions {
  displayLabel?: string;
  gitConfig?: Array<{ key: string; value: string }>;
  repositoryPreparation?: RepositoryPreparationConfig;
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

export function getStagingArchivePath(deploymentId: string): string {
  return join(STAGING_DIR, `${deploymentId}.tar.gz`);
}

function writeGitConfigFile(
  deploymentId: string,
  gitConfig: Array<{ key: string; value: string }>
): string | null {
  if (gitConfig.length === 0) {
    return null;
  }

  const lines = gitConfig.flatMap(({ key, value }) => {
    const [section, ...rest] = key.split(".");
    const configKey = rest.join(".");
    if (!section || !configKey) {
      throw new Error(`Unsupported git config key: ${key}`);
    }

    return [`[${section}]`, `\t${configKey} = ${value}`];
  });

  const configPath = join(STAGING_DIR, `${deploymentId}.gitconfig`);
  writeFileSync(configPath, `${lines.join("\n")}\n`, { mode: 0o600 });
  return configPath;
}

function describeRepositoryPreparation(config: RepositoryPreparationConfig): string[] {
  const required: string[] = [];
  if (config.submodules) {
    required.push("submodules");
  }
  if (config.gitLfs) {
    required.push("Git LFS");
  }
  return required;
}

export async function prepareClonedRepository(
  workDir: string,
  onLog: OnLog,
  options: {
    repositoryPreparation?: RepositoryPreparationConfig;
    gitConfigPath?: string | null;
  },
  execRunner: ExecRunner = execStreaming
): Promise<{ exitCode: number; errorMessage?: string }> {
  const repositoryPreparation = options.repositoryPreparation ?? {
    submodules: false,
    gitLfs: false
  };
  const required = describeRepositoryPreparation(repositoryPreparation);
  if (required.length === 0) {
    return { exitCode: 0 };
  }

  const envOverrides = options.gitConfigPath
    ? { GIT_CONFIG_GLOBAL: options.gitConfigPath }
    : undefined;

  onLog({
    stream: "stdout",
    message: `Preparing repository checkout: ${required.join(", ")}`,
    timestamp: new Date()
  });

  if (repositoryPreparation.gitLfs) {
    const lfsCheck = await execRunner("git", ["lfs", "version"], workDir, onLog, envOverrides);
    if (lfsCheck.exitCode !== 0) {
      return {
        exitCode: lfsCheck.exitCode,
        errorMessage:
          "Git LFS is required for this deployment source, but git-lfs is not available on the worker."
      };
    }
  }

  if (repositoryPreparation.submodules) {
    onLog({
      stream: "stdout",
      message: "Synchronizing git submodules recursively",
      timestamp: new Date()
    });
    const sync = await execRunner(
      "git",
      ["submodule", "sync", "--recursive"],
      workDir,
      onLog,
      envOverrides
    );
    if (sync.exitCode !== 0) {
      return {
        exitCode: sync.exitCode,
        errorMessage: `git submodule sync failed with exit code ${sync.exitCode}`
      };
    }

    onLog({
      stream: "stdout",
      message: "Updating git submodules recursively",
      timestamp: new Date()
    });
    const update = await execRunner(
      "git",
      ["submodule", "update", "--init", "--recursive", "--depth", "1"],
      workDir,
      onLog,
      envOverrides
    );
    if (update.exitCode !== 0) {
      return {
        exitCode: update.exitCode,
        errorMessage: `git submodule update failed with exit code ${update.exitCode}`
      };
    }
  }

  if (repositoryPreparation.gitLfs) {
    onLog({
      stream: "stdout",
      message: "Pulling Git LFS objects",
      timestamp: new Date()
    });
    const lfsPull = await execRunner("git", ["lfs", "pull"], workDir, onLog, envOverrides);
    if (lfsPull.exitCode !== 0) {
      return {
        exitCode: lfsPull.exitCode,
        errorMessage: `git lfs pull failed with exit code ${lfsPull.exitCode}`
      };
    }

    if (repositoryPreparation.submodules) {
      onLog({
        stream: "stdout",
        message: "Pulling Git LFS objects for submodules",
        timestamp: new Date()
      });
      const submoduleLfsPull = await execRunner(
        "git",
        ["submodule", "foreach", "--recursive", "git lfs pull"],
        workDir,
        onLog,
        envOverrides
      );
      if (submoduleLfsPull.exitCode !== 0) {
        return {
          exitCode: submoduleLfsPull.exitCode,
          errorMessage: `git lfs pull failed for submodules with exit code ${submoduleLfsPull.exitCode}`
        };
      }
    }
  }

  return { exitCode: 0 };
}

/**
 * Clean up staging directory after deployment.
 */
export function cleanupStagingDir(deploymentId: string): void {
  const dir = join(STAGING_DIR, deploymentId);
  const archivePath = getStagingArchivePath(deploymentId);
  const gitConfigPath = join(STAGING_DIR, `${deploymentId}.gitconfig`);
  try {
    if (existsSync(dir)) {
      rmSync(dir, { recursive: true, force: true });
    }
    if (existsSync(archivePath)) {
      rmSync(archivePath, { force: true });
    }
    if (existsSync(gitConfigPath)) {
      rmSync(gitConfigPath, { force: true });
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
  onLog: OnLog,
  options?: GitCloneOptions
): Promise<{ exitCode: number; workDir: string; errorMessage?: string }> {
  const workDir = ensureStagingDir(deploymentId);
  const displayLabel = options?.displayLabel ?? repoUrl;
  const gitConfigPath = writeGitConfigFile(deploymentId, options?.gitConfig ?? []);

  onLog({
    stream: "stdout",
    message: `Cloning ${displayLabel} (branch: ${branch}) into ${workDir}`,
    timestamp: new Date()
  });

  const result = await execStreaming(
    "git",
    ["clone", "--depth", "1", "--branch", branch, "--single-branch", repoUrl, "."],
    workDir,
    onLog,
    gitConfigPath ? { GIT_CONFIG_GLOBAL: gitConfigPath } : undefined
  );

  if (result.exitCode !== 0) {
    return {
      exitCode: result.exitCode,
      workDir,
      errorMessage: `git clone failed with exit code ${result.exitCode}`
    };
  }

  const preparation = await prepareClonedRepository(workDir, onLog, {
    repositoryPreparation: options?.repositoryPreparation,
    gitConfigPath
  });

  return {
    exitCode: preparation.exitCode,
    workDir,
    errorMessage: preparation.errorMessage
  };
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
  envFile?: string
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Pulling images for compose project ${projectName}`,
    timestamp: new Date()
  });

  const args = ["compose", "-f", composeFile, "-p", projectName];
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("pull");

  return execStreaming("docker", args, cwd, onLog);
}

/**
 * Deploy services with docker compose up.
 */
export async function dockerComposeUp(
  composeFile: string,
  projectName: string,
  cwd: string,
  onLog: OnLog,
  envFile?: string
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Starting compose project ${projectName}`,
    timestamp: new Date()
  });

  const args = ["compose", "-f", composeFile, "-p", projectName];
  if (envFile) {
    args.push("--env-file", envFile);
  }
  args.push("up", "-d", "--remove-orphans");

  return execStreaming("docker", args, cwd, onLog);
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
