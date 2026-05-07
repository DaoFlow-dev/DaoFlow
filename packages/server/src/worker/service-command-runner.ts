import { spawn, type ChildProcess } from "node:child_process";
import type { ResolvedServiceRuntime } from "../db/services/service-runtime";
import type { ExecutionTarget } from "./execution-target";
import { dockerCommand, sshCommand, withCommandPath } from "./command-env";
import { parseDockerPsLines } from "./service-observability-parsers";
import { collectDockerJsonLines } from "./server-host-command";
import { removeSSHKey, shellQuote, sshArgs, writeSSHKey } from "./ssh-connection";

export interface ServiceCommandResult {
  exitCode: number;
  logs: string;
  timedOut: boolean;
}

async function resolveContainerNames(
  runtime: ResolvedServiceRuntime,
  includeStopped: boolean
): Promise<string[]> {
  if (runtime.kind === "container") {
    return [runtime.containerName];
  }

  const result = await collectDockerJsonLines(runtime.target, [
    "ps",
    ...(includeStopped ? ["-a"] : []),
    "--format",
    "json",
    "--filter",
    `label=com.docker.compose.project=${runtime.projectName}`,
    "--filter",
    `label=com.docker.compose.service=${runtime.composeServiceName}`
  ]);

  return result.exitCode === 0
    ? parseDockerPsLines(result.stdout)
        .map((container) => container.name)
        .filter(Boolean)
        .sort()
    : [];
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

function attachLines(
  stream: NodeJS.ReadableStream | null | undefined,
  prefix: string,
  out: string[]
) {
  let buffer = "";
  stream?.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    out.push(...lines.filter(Boolean).map((line) => `[${prefix}] ${line}`));
  });
  stream?.on("end", () => {
    if (buffer) out.push(`[${prefix}] ${buffer}`);
  });
}

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function resolveRunningContainerName(runtime: ResolvedServiceRuntime) {
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const [containerName] = await resolveContainerNames(runtime, false);
    if (containerName) return containerName;
    if (attempt < 3) await sleep(500);
  }
  return null;
}

export async function runServiceCommand(input: {
  runtime: ResolvedServiceRuntime;
  command: string;
  timeoutMs?: number;
}): Promise<ServiceCommandResult> {
  const containerName = await resolveRunningContainerName(input.runtime);
  if (!containerName) {
    throw new Error("No running container is available for scheduled task execution.");
  }

  const { child, cleanup } = spawnTargetCommand(input.runtime.target, [
    "exec",
    containerName,
    "sh",
    "-lc",
    input.command
  ]);
  const lines: string[] = [];
  let timedOut = false;
  const timeout = setTimeout(
    () => {
      timedOut = true;
      child.kill("SIGTERM");
    },
    input.timeoutMs ?? 15 * 60 * 1000
  );

  attachLines(child.stdout, "stdout", lines);
  attachLines(child.stderr, "stderr", lines);

  return new Promise((resolve, reject) => {
    child.on("error", (error) => {
      clearTimeout(timeout);
      cleanup();
      reject(error);
    });
    child.on("close", (code) => {
      clearTimeout(timeout);
      cleanup();
      resolve({
        exitCode: timedOut ? 124 : (code ?? 1),
        logs: lines.join("\n"),
        timedOut
      });
    });
  });
}
