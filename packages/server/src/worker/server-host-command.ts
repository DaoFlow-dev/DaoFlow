import { spawn } from "node:child_process";
import { dockerCommand, sshCommand, withCommandPath } from "./command-env";
import type { ExecutionTarget } from "./execution-target";
import { shellQuote, sshArgs } from "./ssh-connection";

export interface HostCommandResult {
  exitCode: number;
  stdout: string[];
  stderr: string[];
}

export interface DockerDiskUsageEntry {
  type: string;
  totalCount: string;
  active: string;
  size: string;
  reclaimable: string;
}

function buildRemoteCommand(command: string) {
  return ["sh", "-lc", command].map((part) => shellQuote(part)).join(" ");
}

function spawnShellCommand(target: ExecutionTarget, command: string) {
  if (target.mode === "local") {
    return spawn("sh", ["-lc", command], {
      stdio: ["ignore", "pipe", "pipe"],
      env: withCommandPath(process.env)
    });
  }

  return spawn(sshCommand, [...sshArgs(target.ssh), buildRemoteCommand(command)], {
    stdio: ["ignore", "pipe", "pipe"],
    env: withCommandPath(process.env)
  });
}

export async function collectCommand(
  target: ExecutionTarget,
  command: string
): Promise<HostCommandResult> {
  const child = spawnShellCommand(target, command);
  const stdout: string[] = [];
  const stderr: string[] = [];
  attachLines(child.stdout, stdout);
  attachLines(child.stderr, stderr);

  return await new Promise((resolve, reject) => {
    child.on("error", reject);
    child.on("close", (code) => resolve({ exitCode: code ?? 1, stdout, stderr }));
  });
}

function attachLines(stream: NodeJS.ReadableStream | null | undefined, sink: string[]) {
  let buffer = "";
  stream?.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    sink.push(...lines.filter(Boolean));
  });
  stream?.on("end", () => {
    if (buffer) {
      sink.push(buffer);
    }
  });
}

function readDockerField(value: unknown, fallback: string) {
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  return fallback;
}

export function parseDockerDiskUsage(lines: string[]): DockerDiskUsageEntry[] {
  return lines
    .map((line) => {
      try {
        const value = JSON.parse(line) as Record<string, unknown>;
        return {
          type: readDockerField(value.Type, "unknown"),
          totalCount: readDockerField(value.TotalCount, "0"),
          active: readDockerField(value.Active, "0"),
          size: readDockerField(value.Size, "0B"),
          reclaimable: readDockerField(value.Reclaimable, "0B")
        };
      } catch {
        return null;
      }
    })
    .filter((entry): entry is DockerDiskUsageEntry => entry !== null);
}

export async function collectDockerJsonLines(target: ExecutionTarget, args: string[]) {
  const command = [dockerCommand, ...args.map((arg) => shellQuote(arg))].join(" ");
  return collectCommand(target, command);
}
