/**
 * ssh-connection.ts — SSH connection management and key lifecycle.
 *
 * Extracted from ssh-executor.ts for modularity (AGENTS.md §300-line limit).
 * Contains: connection setup, ControlMaster multiplexing, SSH key management,
 * SCP uploads, connectivity testing, and shell quoting.
 */

import { spawn, type ChildProcess } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, existsSync, writeFileSync, unlinkSync } from "node:fs";
import { join } from "node:path";
import type { OnLog } from "./docker-executor";

const SSH_CONTROL_DIR = process.env.SSH_CONTROL_DIR ?? "/tmp/daoflow-ssh";
const SSH_KEY_DIR = process.env.SSH_KEY_DIR ?? "/tmp/daoflow-ssh-keys";
const DEFAULT_SSH_USER = process.env.SSH_USER ?? "root";
const SSH_CONNECT_TIMEOUT = 10; // seconds

export interface SSHTarget {
  serverName: string;
  host: string;
  port: number;
  user?: string;
  privateKey?: string;
  privateKeyPath?: string;
}

/**
 * Ensure the SSH control directory exists for connection multiplexing.
 */
function ensureControlDir(): void {
  if (!existsSync(SSH_CONTROL_DIR)) {
    mkdirSync(SSH_CONTROL_DIR, { recursive: true, mode: 0o700 });
  }
}

/**
 * Build SSH command arguments for a given target.
 * Includes connection multiplexing, strict host key checking options,
 * and timeout settings.
 */
export function sshArgs(target: SSHTarget): string[] {
  ensureControlDir();

  const controlPath = join(SSH_CONTROL_DIR, `%h-%p-%r`);
  const user = target.user ?? DEFAULT_SSH_USER;
  const keyPath = target.privateKeyPath ?? join(SSH_KEY_DIR, "id_ed25519");

  const args = [
    "-o",
    "StrictHostKeyChecking=accept-new",
    "-o",
    `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
    "-o",
    `ControlMaster=auto`,
    "-o",
    `ControlPath=${controlPath}`,
    "-o",
    `ControlPersist=60`,
    "-o",
    "BatchMode=yes",
    "-o",
    "ServerAliveInterval=15",
    "-o",
    "ServerAliveCountMax=3",
    "-p",
    String(target.port)
  ];

  if (existsSync(keyPath)) {
    args.push("-i", keyPath);
  }

  args.push(`${user}@${target.host}`);
  return args;
}

/**
 * Execute a command on a remote server over SSH with streaming output.
 * This is the SSH equivalent of docker-executor's `execStreaming`.
 */
export function execRemote(
  target: SSHTarget,
  remoteCommand: string,
  onLog: OnLog
): Promise<{ exitCode: number; signal: string | null }> {
  return new Promise((resolve, reject) => {
    const args = [...sshArgs(target), remoteCommand];

    onLog({
      stream: "stdout",
      message: `[ssh] ${target.serverName} → ${remoteCommand.slice(0, 120)}`,
      timestamp: new Date()
    });

    let child: ChildProcess;
    try {
      child = spawn("ssh", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env }
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
 * Write an SSH key to the key directory for a server.
 */
export function writeSSHKey(serverName: string, privateKey: string): string {
  if (!existsSync(SSH_KEY_DIR)) {
    mkdirSync(SSH_KEY_DIR, { recursive: true, mode: 0o700 });
  }
  const keyPath = join(
    SSH_KEY_DIR,
    `${serverName.replace(/[^a-zA-Z0-9_-]/g, "_")}-${randomUUID().slice(0, 8)}_id`
  );
  writeFileSync(keyPath, privateKey, { mode: 0o600 });
  return keyPath;
}

/**
 * Remove an SSH key for a server.
 */
export function removeSSHKey(keyPath: string): void {
  try {
    if (existsSync(keyPath)) unlinkSync(keyPath);
  } catch {
    /* best-effort cleanup */
  }
}

/**
 * Upload a file to a remote server via SCP.
 * Uses the same SSH key and connection options as execRemote.
 */
export function scpUpload(
  target: SSHTarget,
  localPath: string,
  remotePath: string,
  onLog: OnLog
): Promise<{ exitCode: number; signal: string | null }> {
  return new Promise((resolve, reject) => {
    ensureControlDir();

    const controlPath = join(SSH_CONTROL_DIR, `%h-%p-%r`);
    const user = target.user ?? DEFAULT_SSH_USER;
    const keyPath = target.privateKeyPath ?? join(SSH_KEY_DIR, "id_ed25519");

    const args = [
      "-o",
      "StrictHostKeyChecking=accept-new",
      "-o",
      `ConnectTimeout=${SSH_CONNECT_TIMEOUT}`,
      "-o",
      `ControlMaster=auto`,
      "-o",
      `ControlPath=${controlPath}`,
      "-o",
      `ControlPersist=60`,
      "-o",
      "BatchMode=yes",
      "-P",
      String(target.port)
    ];

    if (existsSync(keyPath)) {
      args.push("-i", keyPath);
    }

    args.push(localPath, `${user}@${target.host}:${remotePath}`);

    onLog({
      stream: "stdout",
      message: `[scp] ${target.serverName} → ${localPath} → ${remotePath}`,
      timestamp: new Date()
    });

    let child: ChildProcess;
    try {
      child = spawn("scp", args, {
        stdio: ["ignore", "pipe", "pipe"],
        env: { ...process.env }
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

/**
 * Shell-escape a value for safe inclusion in SSH commands.
 * Uses single quotes (POSIX) which prevent all interpolation.
 */
export function shellQuote(s: string): string {
  // Reject dangerous inputs before quoting
  if (s.length > 4096) throw new Error("Input too long for shell argument");

  // Replace single quotes (%27) with '"'"' pattern
  return `'${s.replace(/'/g, "'\"'\"'")}'`;
}
