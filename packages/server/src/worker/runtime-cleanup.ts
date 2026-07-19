import { spawn, type ChildProcess } from "node:child_process";
import { dockerCommand, sshCommand, withCommandPath } from "./command-env";
import {
  assertComposeRuntimeOwnership,
  assertContainerRuntimeOwnership,
  type ComposeRuntimeOwnershipSnapshot
} from "./compose-runtime-ownership";
import type { OnLog } from "./docker-executor";
import type { ExecutionTarget } from "./execution-target";
import { removeSSHKey, shellQuote, sshArgs, writeSSHKey } from "./ssh-connection";
import type { DockerOwnershipIdentity } from "../docker-ownership";

export interface DockerCommandResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

export type DockerTargetExecutor = (
  target: ExecutionTarget,
  dockerArgs: string[],
  onLog: OnLog
) => Promise<DockerCommandResult>;

export interface ComposeProjectCleanupResult {
  removedContainers: number;
  removedNetworks: number;
  removedVolumes: number;
}

function buildDockerCommand(args: string[]): string {
  return ["docker", ...args].map((part) => shellQuote(part)).join(" ");
}

function spawnTargetCommand(
  target: ExecutionTarget,
  dockerArgs: string[]
): { child: ChildProcess; cleanup: () => void } {
  if (target.mode === "local") {
    return {
      child: spawn(dockerCommand, dockerArgs, {
        stdio: ["ignore", "pipe", "pipe"],
        env: withCommandPath(process.env)
      }),
      cleanup: () => {}
    };
  }

  const sshTarget =
    !target.ssh.privateKeyPath && target.ssh.privateKey
      ? {
          ...target.ssh,
          privateKeyPath: writeSSHKey(target.ssh.serverName, target.ssh.privateKey)
        }
      : target.ssh;

  return {
    child: spawn(sshCommand, [...sshArgs(sshTarget), buildDockerCommand(dockerArgs)], {
      stdio: ["ignore", "pipe", "pipe"],
      env: withCommandPath(process.env)
    }),
    cleanup: () => {
      if (sshTarget.privateKeyPath && sshTarget.privateKeyPath !== target.ssh.privateKeyPath) {
        removeSSHKey(sshTarget.privateKeyPath);
      }
    }
  };
}

export const executeDockerTargetCommand: DockerTargetExecutor = async (
  target,
  dockerArgs,
  onLog
) => {
  const { child, cleanup } = spawnTargetCommand(target, dockerArgs);
  const stdout: string[] = [];
  const stderr: string[] = [];

  const attach = (
    stream: NodeJS.ReadableStream | null | undefined,
    channel: "stdout" | "stderr",
    sink: string[]
  ) => {
    let buffer = "";
    stream?.on("data", (chunk: Buffer | string) => {
      buffer += chunk.toString();
      const lines = buffer.split(/\r?\n/);
      buffer = lines.pop() ?? "";
      for (const line of lines) {
        if (!line) continue;
        sink.push(line);
        onLog({ stream: channel, message: line, timestamp: new Date() });
      }
    });
    stream?.on("end", () => {
      if (!buffer) return;
      sink.push(buffer);
      onLog({ stream: channel, message: buffer, timestamp: new Date() });
    });
  };

  attach(child.stdout, "stdout", stdout);
  attach(child.stderr, "stderr", stderr);

  return await new Promise((resolve, reject) => {
    child.on("error", (error) => {
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      cleanup();
      resolve({
        exitCode: code ?? 1,
        stdout,
        stderr
      });
    });
  });
};

function summarizeFailure(result: DockerCommandResult): string {
  return [...result.stderr, ...result.stdout].join(" ").trim() || `exit code ${result.exitCode}`;
}

async function removeDockerObjects(
  target: ExecutionTarget,
  dockerArgs: string[],
  onLog: OnLog,
  execute: DockerTargetExecutor
): Promise<void> {
  const result = await execute(target, dockerArgs, onLog);
  if (result.exitCode !== 0) {
    throw new Error(summarizeFailure(result));
  }
}

export async function cleanupComposeProjectRuntime(
  target: ExecutionTarget,
  projectName: string,
  ownershipScopes: readonly DockerOwnershipIdentity[],
  onLog: OnLog,
  execute: DockerTargetExecutor = executeDockerTargetCommand,
  verifiedResources?: ComposeRuntimeOwnershipSnapshot
): Promise<ComposeProjectCleanupResult> {
  const resources =
    verifiedResources ??
    (await assertComposeRuntimeOwnership({
      kind: "compose",
      runtimeName: projectName,
      ownershipScopes,
      target,
      onLog,
      execute
    }));

  onLog({
    stream: "stdout",
    message: `Cleaning compose runtime for project ${projectName}`,
    timestamp: new Date()
  });

  if (resources.containers.length > 0) {
    await removeDockerObjects(target, ["rm", "-f", ...resources.containers], onLog, execute);
  }

  if (resources.networks.length > 0) {
    await removeDockerObjects(target, ["network", "rm", ...resources.networks], onLog, execute);
  }

  return {
    removedContainers: resources.containers.length,
    removedNetworks: resources.networks.length,
    removedVolumes: 0
  };
}

export async function cleanupContainerRuntime(
  target: ExecutionTarget,
  containerName: string,
  ownershipScopes: readonly DockerOwnershipIdentity[],
  onLog: OnLog,
  execute: DockerTargetExecutor = executeDockerTargetCommand
): Promise<void> {
  const containerId = await assertContainerRuntimeOwnership({
    containerName,
    ownershipScopes,
    target,
    onLog,
    execute
  });
  if (!containerId) return;

  onLog({
    stream: "stdout",
    message: `Cleaning container runtime for ${containerName}`,
    timestamp: new Date()
  });

  const result = await execute(target, ["rm", "-f", containerId], onLog);
  if (result.exitCode === 0) {
    return;
  }

  const failure = summarizeFailure(result);
  if (/No such container/i.test(failure)) {
    return;
  }

  throw new Error(failure);
}

export async function cleanupSwarmStackRuntime(
  target: ExecutionTarget,
  stackName: string,
  ownershipScopes: readonly DockerOwnershipIdentity[],
  onLog: OnLog,
  execute: DockerTargetExecutor = executeDockerTargetCommand,
  verifiedResources?: ComposeRuntimeOwnershipSnapshot
): Promise<void> {
  const resources =
    verifiedResources ??
    (await assertComposeRuntimeOwnership({
      kind: "swarm",
      runtimeName: stackName,
      ownershipScopes,
      target,
      onLog,
      execute
    }));

  onLog({
    stream: "stdout",
    message: `Cleaning Swarm runtime for stack ${stackName}`,
    timestamp: new Date()
  });

  if (resources.services.length > 0) {
    await removeDockerObjects(target, ["service", "rm", ...resources.services], onLog, execute);
  }
  if (resources.networks.length > 0) {
    await removeDockerObjects(target, ["network", "rm", ...resources.networks], onLog, execute);
  }
  if (resources.configs.length > 0) {
    await removeDockerObjects(target, ["config", "rm", ...resources.configs], onLog, execute);
  }
  if (resources.secrets.length > 0) {
    await removeDockerObjects(target, ["secret", "rm", ...resources.secrets], onLog, execute);
  }
}
