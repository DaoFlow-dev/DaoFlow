import type { ContainerRegistryCredential } from "../container-registries-shared";
import { dockerCommand } from "./command-env";
import { execStreaming, type OnLog, STAGING_DIR } from "./docker-exec-shared";
import { wrapDockerCommandWithRegistryAuth } from "./registry-auth";

export interface DockerImageListEntry {
  Repository: string;
  Tag: string;
  ID: string;
  CreatedAt: string;
  Size: string;
}

/**
 * Build a Docker image from a Dockerfile.
 */
export async function dockerBuild(
  context: string,
  dockerfile: string,
  tag: string,
  onLog: OnLog,
  registryCredentials: ContainerRegistryCredential[] = []
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Building image ${tag} from ${dockerfile}`,
    timestamp: new Date()
  });

  const execution = wrapDockerCommandWithRegistryAuth({
    command: dockerCommand,
    args: ["build", "-t", tag, "-f", dockerfile, "."],
    registries: registryCredentials
  });
  const execOptions = execution.stdin === undefined ? undefined : { stdin: execution.stdin };

  return execStreaming(execution.command, execution.args, context, onLog, undefined, execOptions);
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
export async function dockerPull(
  tag: string,
  onLog: OnLog,
  registryCredentials: ContainerRegistryCredential[] = []
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Pulling image ${tag}`,
    timestamp: new Date()
  });

  const execution = wrapDockerCommandWithRegistryAuth({
    command: dockerCommand,
    args: ["pull", tag],
    registries: registryCredentials
  });
  const execOptions = execution.stdin === undefined ? undefined : { stdin: execution.stdin };

  return execStreaming(
    execution.command,
    execution.args,
    STAGING_DIR,
    onLog,
    undefined,
    execOptions
  );
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
