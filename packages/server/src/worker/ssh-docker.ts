/**
 * ssh-docker.ts — Remote Docker commands over SSH.
 *
 * Extracted from ssh-executor.ts for modularity (AGENTS.md §300-line limit).
 * Contains: remote Docker image, run, health, archive, and log commands.
 * All functions delegate to execRemote from ssh-connection.ts.
 */

import type { ContainerRegistryCredential } from "../container-registries-shared";
import type { DockerOwnershipLabels } from "../docker-ownership";
import type { OnLog } from "./docker-executor";
import { buildRegistryAwareShellCommand } from "./registry-auth";
import { execRemote, shellQuote, type SSHTarget } from "./ssh-connection";
import {
  buildDockerOwnershipLabelInspectFormat,
  parseDockerOwnershipLabelLine
} from "./docker-ownership-inspect";

export function dockerLabelFlags(labels: DockerOwnershipLabels): string {
  return Object.entries(labels)
    .map(([key, value]) => ` --label ${shellQuote(`${key}=${value}`)}`)
    .join("");
}

export function buildRemoteDockerRunCommand(
  tag: string,
  containerName: string,
  options: {
    ports?: string[];
    volumes?: string[];
    env?: Record<string, string>;
    network?: string;
    labels?: DockerOwnershipLabels;
  }
): string {
  let cmd = `docker run -d --name ${shellQuote(containerName)} --restart unless-stopped`;
  if (options.labels) cmd += dockerLabelFlags(options.labels);
  if (options.network) cmd += ` --network ${shellQuote(options.network)}`;
  for (const p of options.ports ?? []) cmd += ` -p ${shellQuote(p)}`;
  for (const v of options.volumes ?? []) cmd += ` -v ${shellQuote(v)}`;
  for (const [k, val] of Object.entries(options.env ?? {})) {
    cmd += ` -e ${shellQuote(`${k}=${val}`)}`;
  }
  return `${cmd} ${shellQuote(tag)}`;
}

export function buildRemoteDockerMetadataWrapperCommand(
  sourceTag: string,
  outputTag: string,
  labels: DockerOwnershipLabels
): string {
  return [
    "printf '%s\\n' 'ARG BASE_IMAGE' 'FROM ${BASE_IMAGE}' | docker build",
    `--build-arg ${shellQuote(`BASE_IMAGE=${sourceTag}`)}`,
    dockerLabelFlags(labels),
    `-t ${shellQuote(outputTag)} -f - .`
  ].join(" ");
}

export function buildRemoteDockerBuildScript(
  context: string,
  dockerfile: string,
  tag: string,
  labels: DockerOwnershipLabels,
  registryCredentials: ContainerRegistryCredential[]
): string {
  return [
    "set -e",
    `cd ${shellQuote(context)}`,
    buildRegistryAwareShellCommand(
      `docker build${dockerLabelFlags(labels)} -t ${shellQuote(tag)} -f ${shellQuote(dockerfile)} .`,
      registryCredentials
    )
  ].join("\n");
}

export async function remoteDockerPull(
  target: SSHTarget,
  tag: string,
  onLog: OnLog,
  registryCredentials: ContainerRegistryCredential[] = [],
  signal?: AbortSignal
): Promise<{ exitCode: number }> {
  const result = await execRemote(target, "sh", onLog, {
    preview: `docker pull ${tag}`,
    stdin: buildRegistryAwareShellCommand(`docker pull ${shellQuote(tag)}`, registryCredentials),
    signal
  });
  return { exitCode: result.exitCode };
}

export async function remoteDockerRun(
  target: SSHTarget,
  tag: string,
  containerName: string,
  options: {
    ports?: string[];
    volumes?: string[];
    env?: Record<string, string>;
    network?: string;
    labels?: DockerOwnershipLabels;
  },
  onLog: OnLog,
  signal?: AbortSignal
): Promise<{ exitCode: number }> {
  const result = await execRemote(
    target,
    buildRemoteDockerRunCommand(tag, containerName, options),
    onLog,
    {
      signal
    }
  );
  return { exitCode: result.exitCode };
}

export async function remoteDockerBuild(
  target: SSHTarget,
  context: string,
  dockerfile: string,
  tag: string,
  labels: DockerOwnershipLabels,
  onLog: OnLog,
  registryCredentials: ContainerRegistryCredential[] = [],
  signal?: AbortSignal
): Promise<{ exitCode: number }> {
  const result = await execRemote(target, "sh", onLog, {
    preview: `docker build -t ${tag} -f ${dockerfile} .`,
    stdin: buildRemoteDockerBuildScript(context, dockerfile, tag, labels, registryCredentials),
    signal
  });
  return { exitCode: result.exitCode };
}

export async function inspectRemoteDockerVolume(
  target: SSHTarget,
  name: string,
  onLog: OnLog,
  signal?: AbortSignal
): Promise<{ exists: boolean; labels: Record<string, string> }> {
  const output: string[] = [];
  const result = await execRemote(
    target,
    `docker volume inspect --format ${shellQuote(buildDockerOwnershipLabelInspectFormat(".Labels"))} ${shellQuote(name)}`,
    (line) => {
      onLog(line);
      output.push(line.message);
    },
    { signal }
  );
  const rawOutput = output.join("\n");
  if (result.exitCode !== 0) {
    if (/no such volume/i.test(rawOutput)) {
      return { exists: false, labels: {} };
    }
    throw new Error(`Unable to inspect Docker volume "${name}" on ${target.serverName}.`);
  }

  const labels = parseDockerOwnershipLabelLine(rawOutput);
  if (!labels) {
    throw new Error(`Docker volume "${name}" returned unreadable labels.`);
  }
  return { exists: true, labels };
}

export async function createRemoteDockerVolume(
  target: SSHTarget,
  name: string,
  labels: DockerOwnershipLabels,
  onLog: OnLog,
  signal?: AbortSignal
): Promise<{ exitCode: number }> {
  const result = await execRemote(
    target,
    `docker volume create${dockerLabelFlags(labels)} ${shellQuote(name)}`,
    onLog,
    { signal }
  );
  return { exitCode: result.exitCode };
}

export async function remoteDockerBuildMetadataWrapper(
  target: SSHTarget,
  sourceTag: string,
  outputTag: string,
  labels: DockerOwnershipLabels,
  onLog: OnLog,
  signal?: AbortSignal
): Promise<{ exitCode: number }> {
  const result = await execRemote(
    target,
    buildRemoteDockerMetadataWrapperCommand(sourceTag, outputTag, labels),
    onLog,
    { signal }
  );
  return { exitCode: result.exitCode };
}

export async function remoteGitClone(
  target: SSHTarget,
  repoUrl: string,
  branch: string,
  workDir: string,
  onLog: OnLog,
  displayLabel = repoUrl
): Promise<{ exitCode: number }> {
  onLog({
    stream: "stdout",
    message: `Cloning ${displayLabel} (branch: ${branch}) into remote workspace ${workDir}`,
    timestamp: new Date()
  });

  const cmd = `mkdir -p ${shellQuote(workDir)} && cd ${shellQuote(workDir)} && git clone --depth 1 --branch ${shellQuote(branch)} --single-branch -- ${shellQuote(repoUrl)} .`;
  const result = await execRemote(target, cmd, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteEnsureDir(
  target: SSHTarget,
  remoteDir: string,
  onLog: OnLog,
  signal?: AbortSignal
): Promise<{ exitCode: number }> {
  const result = await execRemote(target, `mkdir -p ${shellQuote(remoteDir)}`, onLog, { signal });
  return { exitCode: result.exitCode };
}

export async function remoteExtractArchive(
  target: SSHTarget,
  archivePath: string,
  destinationDir: string,
  onLog: OnLog,
  signal?: AbortSignal
): Promise<{ exitCode: number }> {
  const cmd = `mkdir -p ${shellQuote(destinationDir)} && tar -xzf ${shellQuote(archivePath)} -C ${shellQuote(destinationDir)}`;
  const result = await execRemote(target, cmd, onLog, { signal });
  return { exitCode: result.exitCode };
}

export async function remoteCheckContainerHealth(
  target: SSHTarget,
  containerName: string,
  onLog: OnLog,
  signal?: AbortSignal
): Promise<boolean> {
  let healthy = false;
  const result = await execRemote(
    target,
    `docker inspect --format '{{.State.Status}}' ${shellQuote(containerName)}`,
    (line) => {
      onLog(line);
      if (line.stream === "stdout" && line.message.trim() === "running") {
        healthy = true;
      }
    },
    { signal }
  );
  return result.exitCode === 0 && healthy;
}

/**
 * Stream container logs from a remote server.
 */
export async function remoteDockerLogs(
  target: SSHTarget,
  containerName: string,
  follow: boolean,
  tail: number,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  const followFlag = follow ? " -f" : "";
  const cmd = `docker logs --tail ${tail}${followFlag} ${shellQuote(containerName)}`;
  const result = await execRemote(target, cmd, onLog);
  return { exitCode: result.exitCode };
}
