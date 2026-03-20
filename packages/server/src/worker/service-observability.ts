import { spawn, type ChildProcess } from "node:child_process";
import type { ExecutionTarget } from "./execution-target";
import { removeSSHKey, shellQuote, sshArgs, writeSSHKey } from "./ssh-connection";
import type { ResolvedServiceRuntime } from "../db/services/service-runtime";
import {
  formatUptime,
  parseDockerPsLines,
  parseDockerStateLines,
  parseDockerStatsLines,
  type ServiceContainerRef
} from "./service-observability-parsers";

export interface ServiceStatsSnapshot {
  cpuPercent: number;
  memoryUsageMB: number;
  memoryLimitMB: number;
  memoryPercent: number;
  networkRxMB: number;
  networkTxMB: number;
  blockReadMB: number;
  blockWriteMB: number;
  pids: number;
  uptime: string;
  restartCount: number;
}

export interface ServiceLogLine {
  timestamp: string;
  message: string;
  stream: "stdout" | "stderr";
}

export interface ServiceStreamHandle {
  close(): void;
}

export interface ServiceTerminalHandle extends ServiceStreamHandle {
  write(chunk: string): void;
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
      child: spawn("docker", dockerArgs, {
        stdio: ["pipe", "pipe", "pipe"],
        env: { ...process.env }
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
    child: spawn("ssh", [...sshArgs(sshTarget), buildDockerCommand(dockerArgs)], {
      stdio: ["pipe", "pipe", "pipe"],
      env: { ...process.env }
    }),
    cleanup: () => {
      if (sshTarget.privateKeyPath && sshTarget.privateKeyPath !== target.ssh.privateKeyPath) {
        removeSSHKey(sshTarget.privateKeyPath);
      }
    }
  };
}

function attachLineEmitter(
  stream: NodeJS.ReadableStream | null | undefined,
  channel: "stdout" | "stderr",
  onLine: (stream: "stdout" | "stderr", line: string) => void
) {
  let buffer = "";
  stream?.on("data", (chunk: Buffer | string) => {
    buffer += chunk.toString();
    const lines = buffer.split(/\r?\n/);
    buffer = lines.pop() ?? "";
    for (const line of lines) {
      if (line.length > 0) {
        onLine(channel, line);
      }
    }
  });
  stream?.on("end", () => {
    if (buffer.length > 0) {
      onLine(channel, buffer);
      buffer = "";
    }
  });
}

async function collectDockerLines(
  target: ExecutionTarget,
  dockerArgs: string[]
): Promise<{ exitCode: number; stdout: string[]; stderr: string[] }> {
  const { child, cleanup } = spawnTargetCommand(target, dockerArgs);
  const stdout: string[] = [];
  const stderr: string[] = [];

  attachLineEmitter(child.stdout, "stdout", (_stream, line) => stdout.push(line));
  attachLineEmitter(child.stderr, "stderr", (_stream, line) => stderr.push(line));

  return new Promise((resolve, reject) => {
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
}

async function listComposeContainers(
  target: ExecutionTarget,
  runtime: Extract<ResolvedServiceRuntime, { kind: "compose" }>,
  includeStopped: boolean
): Promise<ServiceContainerRef[]> {
  const args = ["ps", ...(includeStopped ? ["-a"] : []), "--format", "json"];
  args.push("--filter", `label=com.docker.compose.project=${runtime.projectName}`);
  args.push("--filter", `label=com.docker.compose.service=${runtime.composeServiceName}`);

  const result = await collectDockerLines(target, args);
  return result.exitCode === 0 ? parseDockerPsLines(result.stdout) : [];
}

async function resolveContainerNames(
  runtime: ResolvedServiceRuntime,
  includeStopped: boolean
): Promise<string[]> {
  if (runtime.kind === "container") {
    return [runtime.containerName];
  }

  const containers = await listComposeContainers(runtime.target, runtime, includeStopped);
  return containers
    .map((container) => container.name)
    .filter(Boolean)
    .sort();
}

function parseLogLine(
  rawLine: string,
  stream: "stdout" | "stderr",
  containerName?: string
): ServiceLogLine {
  const match = rawLine.match(/^(\d{4}-\d{2}-\d{2}T[^\s]+)\s+(.*)$/);
  const timestamp =
    match?.[1] && !Number.isNaN(Date.parse(match[1]))
      ? new Date(match[1]).toISOString()
      : new Date().toISOString();
  const message = match?.[2] ?? rawLine;

  return {
    timestamp,
    message: containerName ? `[${containerName}] ${message}` : message,
    stream
  };
}

export async function readServiceStats(
  runtime: ResolvedServiceRuntime
): Promise<ServiceStatsSnapshot | null> {
  const containerNames = await resolveContainerNames(runtime, false);
  if (containerNames.length === 0) {
    return null;
  }

  const [statsResult, stateResult] = await Promise.all([
    collectDockerLines(runtime.target, [
      "stats",
      "--no-stream",
      "--format",
      "json",
      ...containerNames
    ]),
    collectDockerLines(runtime.target, [
      "inspect",
      "--format",
      "{{json .State}}",
      ...containerNames
    ])
  ]);

  if (statsResult.exitCode !== 0 || stateResult.exitCode !== 0) {
    return null;
  }

  const stats = parseDockerStatsLines(statsResult.stdout);
  const states = parseDockerStateLines(stateResult.stdout);
  if (stats.length === 0) {
    return null;
  }

  const memoryUsageMB = stats.reduce((sum, entry) => sum + entry.memoryUsageMB, 0);
  const memoryLimitMB = stats.reduce((sum, entry) => sum + entry.memoryLimitMB, 0);

  return {
    cpuPercent: stats.reduce((sum, entry) => sum + entry.cpuPercent, 0),
    memoryUsageMB,
    memoryLimitMB,
    memoryPercent: memoryLimitMB > 0 ? (memoryUsageMB / memoryLimitMB) * 100 : 0,
    networkRxMB: stats.reduce((sum, entry) => sum + entry.networkRxMB, 0),
    networkTxMB: stats.reduce((sum, entry) => sum + entry.networkTxMB, 0),
    blockReadMB: stats.reduce((sum, entry) => sum + entry.blockReadMB, 0),
    blockWriteMB: stats.reduce((sum, entry) => sum + entry.blockWriteMB, 0),
    pids: stats.reduce((sum, entry) => sum + entry.pids, 0),
    uptime: formatUptime(states.map((entry) => entry.startedAt)),
    restartCount: states.reduce((sum, entry) => sum + entry.restartCount, 0)
  };
}

export async function startServiceLogStream(input: {
  runtime: ResolvedServiceRuntime;
  tail: number;
  onLine: (line: ServiceLogLine) => void;
  onExit?: (code: number | null) => void;
}): Promise<ServiceStreamHandle> {
  const containerNames = await resolveContainerNames(input.runtime, true);
  if (containerNames.length === 0) {
    throw new Error("No runtime containers were found for this service.");
  }

  const children = containerNames.map((containerName) => {
    const { child, cleanup } = spawnTargetCommand(input.runtime.target, [
      "logs",
      "--timestamps",
      "--tail",
      String(input.tail),
      "-f",
      containerName
    ]);
    attachLineEmitter(child.stdout, "stdout", (stream, line) =>
      input.onLine(
        parseLogLine(line, stream, containerNames.length > 1 ? containerName : undefined)
      )
    );
    attachLineEmitter(child.stderr, "stderr", (stream, line) =>
      input.onLine(
        parseLogLine(line, stream, containerNames.length > 1 ? containerName : undefined)
      )
    );
    child.on("close", (code) => {
      cleanup();
      input.onExit?.(code);
    });
    child.on("error", cleanup);
    return { child, cleanup };
  });

  return {
    close() {
      for (const entry of children) {
        entry.child.kill("SIGTERM");
        entry.cleanup();
      }
    }
  };
}

export async function startServiceTerminal(input: {
  runtime: ResolvedServiceRuntime;
  shell: "bash" | "sh";
  onData: (chunk: string) => void;
  onExit?: (code: number | null) => void;
}): Promise<ServiceTerminalHandle> {
  const containerNames = await resolveContainerNames(input.runtime, false);
  const [containerName] = containerNames;
  if (!containerName) {
    throw new Error("No running container is available for terminal access.");
  }

  const { child, cleanup } = spawnTargetCommand(input.runtime.target, [
    "exec",
    "-i",
    containerName,
    input.shell,
    "-i"
  ]);

  child.stdout?.on("data", (chunk: Buffer | string) => {
    input.onData(chunk.toString());
  });
  child.stderr?.on("data", (chunk: Buffer | string) => {
    input.onData(chunk.toString());
  });

  child.on("close", (code) => {
    cleanup();
    input.onExit?.(code);
  });
  child.on("error", cleanup);

  return {
    write(chunk: string) {
      child.stdin?.write(chunk);
    },
    close() {
      child.kill("SIGTERM");
      cleanup();
    }
  };
}
