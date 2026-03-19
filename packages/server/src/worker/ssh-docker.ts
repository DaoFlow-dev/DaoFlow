/**
 * ssh-docker.ts — Remote Docker commands over SSH.
 *
 * Extracted from ssh-executor.ts for modularity (AGENTS.md §300-line limit).
 * Contains: remote Docker image, run, health, archive, and log commands.
 * All functions delegate to execRemote from ssh-connection.ts.
 */

import type { OnLog } from "./docker-executor";
import { execRemote, shellQuote, type SSHTarget } from "./ssh-connection";

export async function remoteDockerPull(
  target: SSHTarget,
  tag: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  const result = await execRemote(target, `docker pull ${shellQuote(tag)}`, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteDockerRun(
  target: SSHTarget,
  tag: string,
  containerName: string,
  options: { ports?: string[]; volumes?: string[]; env?: Record<string, string>; network?: string },
  onLog: OnLog
): Promise<{ exitCode: number }> {
  let cmd = `docker run -d --name ${shellQuote(containerName)} --restart unless-stopped`;
  if (options.network) cmd += ` --network ${shellQuote(options.network)}`;
  for (const p of options.ports ?? []) cmd += ` -p ${shellQuote(p)}`;
  for (const v of options.volumes ?? []) cmd += ` -v ${shellQuote(v)}`;
  for (const [k, val] of Object.entries(options.env ?? {}))
    cmd += ` -e ${shellQuote(`${k}=${val}`)}`;
  cmd += ` ${shellQuote(tag)}`;

  const result = await execRemote(target, cmd, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteDockerBuild(
  target: SSHTarget,
  context: string,
  dockerfile: string,
  tag: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  const cmd = `cd ${shellQuote(context)} && docker build -t ${shellQuote(tag)} -f ${shellQuote(dockerfile)} .`;
  const result = await execRemote(target, cmd, onLog);
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
  onLog: OnLog
): Promise<{ exitCode: number }> {
  const result = await execRemote(target, `mkdir -p ${shellQuote(remoteDir)}`, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteExtractArchive(
  target: SSHTarget,
  archivePath: string,
  destinationDir: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  const cmd = `mkdir -p ${shellQuote(destinationDir)} && tar -xzf ${shellQuote(archivePath)} -C ${shellQuote(destinationDir)}`;
  const result = await execRemote(target, cmd, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteCheckContainerHealth(
  target: SSHTarget,
  containerName: string,
  onLog: OnLog
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
    }
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
