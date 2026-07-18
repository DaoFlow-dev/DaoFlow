/**
 * ssh-connection.ts — SSH connection management and key lifecycle.
 *
 * Extracted from ssh-executor.ts for modularity (AGENTS.md §300-line limit).
 * Contains: connection setup, ControlMaster multiplexing, SSH key management,
 * SCP uploads, connectivity testing, and shell quoting.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { createHash } from "node:crypto";
import { existsSync, lstatSync, mkdirSync } from "node:fs";
import { isAbsolute, join } from "node:path";
import type { OnLog } from "./docker-executor";
import { scpCommand, sshCommand, withCommandPath } from "./command-env";
import { materializeManagedKnownHosts, type ManagedSshHostIdentity } from "./ssh-known-hosts";

export { removeSSHKey, writeSSHKey } from "./ssh-key-files";
export { shellQuote } from "./ssh-shell";

const SSH_CONNECT_TIMEOUT = 10; // seconds

function getSSHControlDir(): string {
  return process.env.SSH_CONTROL_DIR ?? "/tmp/daoflow-ssh";
}

function getSSHKeyDir(): string {
  return process.env.SSH_KEY_DIR ?? "/tmp/daoflow-ssh-keys";
}

function getDefaultSSHUser(): string {
  return process.env.SSH_USER ?? "root";
}

export interface SSHTarget {
  serverName: string;
  host: string;
  port: number;
  user?: string;
  privateKey?: string;
  privateKeyPath?: string;
  hostIdentity?: ManagedSshHostIdentity;
}

export interface ExecRemoteOptions {
  preview?: string;
  stdin?: string;
  signal?: AbortSignal;
}

/**
 * Ensure the SSH control directory exists for connection multiplexing.
 */
function ensureControlDir(): void {
  const controlDir = getSSHControlDir();
  if (!isAbsolute(controlDir)) {
    throw new Error("SSH_CONTROL_DIR must be an absolute path.");
  }
  mkdirSync(controlDir, { recursive: true, mode: 0o700 });
  const stats = lstatSync(controlDir);
  if (!stats.isDirectory() || stats.isSymbolicLink()) {
    throw new Error("SSH control directory must be a real directory, not a symbolic link.");
  }
  const userId = process.getuid?.();
  if (typeof userId !== "number" || stats.uid !== userId) {
    throw new Error("SSH control directory must be owned by the DaoFlow runtime user.");
  }
  if ((stats.mode & 0o777) !== 0o700) {
    throw new Error("SSH control directory must have permissions 700.");
  }
}

interface SSHResolvedIdentity {
  destination: string;
  keyPath: string;
}

interface SSHTransportArgOptions {
  portFlag: "-p" | "-P";
  includeKeepAlive?: boolean;
}

function resolveSSHIdentity(target: SSHTarget): SSHResolvedIdentity {
  const user = target.user ?? getDefaultSSHUser();
  const keyPath = target.privateKeyPath ?? join(getSSHKeyDir(), "id_ed25519");

  return {
    destination: `${user}@${target.host}`,
    keyPath
  };
}

function buildSSHTransportArgs(
  target: SSHTarget,
  options: SSHTransportArgOptions
): SSHResolvedIdentity & { args: string[] } {
  ensureControlDir();

  const trustStore = materializeManagedKnownHosts({
    host: target.host,
    port: target.port,
    identity: target.hostIdentity
  });
  const identity = resolveSSHIdentity(target);
  const controlPathToken = createHash("sha256")
    .update(`${identity.destination}:${target.port}:${trustStore.controlPathToken}`)
    .digest("hex")
    .slice(0, 32);
  const controlPath = join(getSSHControlDir(), `cm-${controlPathToken}`);
  const args = [
    "-o",
    "StrictHostKeyChecking=yes",
    "-o",
    `UserKnownHostsFile=${trustStore.path}`,
    "-o",
    `GlobalKnownHostsFile=${trustStore.path}`,
    "-o",
    "UpdateHostKeys=no",
    "-o",
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
    "-o",
    "ControlMaster=auto",
    "-o",
    `ControlPath=${controlPath}`,
    "-o",
    "ControlPersist=60",
    "-o",
    "BatchMode=yes"
  ];

  if (options.includeKeepAlive) {
    args.push("-o", "ServerAliveInterval=15", "-o", "ServerAliveCountMax=3");
  }

  args.push(options.portFlag, String(target.port));

  if (existsSync(identity.keyPath)) {
    args.push("-i", identity.keyPath);
  }

  return { ...identity, args };
}

/**
 * Build SSH command arguments for a given target.
 * Includes connection multiplexing, strict host key checking options,
 * and timeout settings.
 */
export function sshArgs(target: SSHTarget): string[] {
  const transport = buildSSHTransportArgs(target, {
    portFlag: "-p",
    includeKeepAlive: true
  });
  return [...transport.args, transport.destination];
}

/**
 * Execute a command on a remote server over SSH with streaming output.
 * This is the SSH equivalent of docker-executor's `execStreaming`.
 */
export function execRemote(
  target: SSHTarget,
  remoteCommand: string,
  onLog: OnLog,
  options?: ExecRemoteOptions
): Promise<{ exitCode: number; signal: string | null }> {
  return new Promise((resolve, reject) => {
    const args = [...sshArgs(target), remoteCommand];
    const preview = options?.preview ?? remoteCommand;

    onLog({
      stream: "stdout",
      message: `[ssh] ${target.serverName} → ${preview.slice(0, 120)}`,
      timestamp: new Date()
    });

    let child: ChildProcess;
    try {
      child = spawn(sshCommand, args, {
        stdio: [options?.stdin === undefined ? "ignore" : "pipe", "pipe", "pipe"],
        env: withCommandPath(process.env),
        signal: options?.signal
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

    if (options?.stdin !== undefined) {
      child.stdin?.end(options.stdin.endsWith("\n") ? options.stdin : `${options.stdin}\n`);
    }

    child.on("close", (code, signal) => {
      resolve({ exitCode: code ?? 1, signal: signal ?? null });
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}

/**
 * Test SSH connectivity to a server.
 * Returns detailed diagnostics for the server status page.
 */
export async function testSSHConnection(
  target: SSHTarget,
  onLog: OnLog
): Promise<{
  reachable: boolean;
  latencyMs: number;
  error?: string;
}> {
  const start = Date.now();
  try {
    const result = await execRemote(target, "echo daoflow-ping", onLog);
    const latencyMs = Date.now() - start;
    return {
      reachable: result.exitCode === 0,
      latencyMs,
      error: result.exitCode !== 0 ? `SSH exited with code ${result.exitCode}` : undefined
    };
  } catch (err) {
    return {
      reachable: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

/**
 * Detect Docker version on a remote server.
 */
export async function detectDockerVersion(
  target: SSHTarget,
  onLog: OnLog
): Promise<{ docker?: string; compose?: string }> {
  const versions: { docker?: string; compose?: string } = {};

  // Docker version
  await execRemote(target, "docker version --format '{{.Server.Version}}'", (line) => {
    onLog(line);
    if (line.stream === "stdout" && line.message.match(/^\d+\.\d+/)) {
      versions.docker = line.message.trim();
    }
  });

  // Compose version
  await execRemote(target, "docker compose version --short", (line) => {
    onLog(line);
    if (line.stream === "stdout" && line.message.match(/^\d+\.\d+/)) {
      versions.compose = line.message.trim();
    }
  });

  return versions;
}

/**
 * Upload a file to a remote server via SCP.
 * Uses the same SSH key and connection options as execRemote.
 */
export function scpUpload(
  target: SSHTarget,
  localPath: string,
  remotePath: string,
  onLog: OnLog,
  signal?: AbortSignal
): Promise<{ exitCode: number; signal: string | null }> {
  return new Promise((resolve, reject) => {
    const transport = buildSSHTransportArgs(target, {
      portFlag: "-P"
    });
    const args = [...transport.args, localPath, `${transport.destination}:${remotePath}`];

    onLog({
      stream: "stdout",
      message: `[scp] ${target.serverName} → ${localPath} → ${remotePath}`,
      timestamp: new Date()
    });

    let child: ChildProcess;
    try {
      child = spawn(scpCommand, args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: withCommandPath(process.env),
        signal
      });
    } catch (err) {
      reject(err instanceof Error ? err : new Error(String(err)));
      return;
    }

    child.stderr?.on("data", (data: Buffer) => {
      const text = data.toString("utf-8").trimEnd();
      if (text.length > 0) {
        onLog({ stream: "stderr", message: text, timestamp: new Date() });
      }
    });

    child.on("close", (code, signal) => {
      resolve({ exitCode: code ?? 1, signal: signal ?? null });
    });

    child.on("error", (err) => {
      reject(err);
    });
  });
}
