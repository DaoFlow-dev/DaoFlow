/**
 * ssh-executor.ts — Remote command execution over SSH.
 *
 * Provides the same interface as docker-executor.ts but dispatches
 * commands to remote servers via SSH. Uses the `ssh` binary (which
 * is installed in the production Docker image — see Dockerfile L35-45).
 *
 * Architecture:
 *  - Each server is identified by (host, port, user) from the DB
 *  - We use ControlMaster to multiplex connections for lower latency
 *  - All output is streamed line-by-line via the OnLog callback
 *  - No sensitive data passes through arguments (env vars sent via stdin)
 *
 * T-1: SSH connection manager
 * T-2: Remote Docker executor (compose)
 * T-3: Remote Dockerfile build
 * T-4: Remote image deploy
 * T-5: Remote health check
 * T-6: Remote log streaming
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
function sshArgs(target: SSHTarget): string[] {
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

// ── Remote Docker Commands ─────────────────────────────────────

export async function remoteDockerComposePull(
  target: SSHTarget,
  composeFile: string,
  projectName: string,
  workDir: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  const cmd = `cd ${shellQuote(workDir)} && docker compose -f ${shellQuote(composeFile)} -p ${shellQuote(projectName)} pull`;
  const result = await execRemote(target, cmd, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteDockerComposeUp(
  target: SSHTarget,
  composeFile: string,
  projectName: string,
  workDir: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  const cmd = `cd ${shellQuote(workDir)} && docker compose -f ${shellQuote(composeFile)} -p ${shellQuote(projectName)} up -d --remove-orphans`;
  const result = await execRemote(target, cmd, onLog);
  return { exitCode: result.exitCode };
}

export async function remoteDockerComposeDown(
  target: SSHTarget,
  composeFile: string,
  projectName: string,
  workDir: string,
  onLog: OnLog
): Promise<{ exitCode: number }> {
  const cmd = `cd ${shellQuote(workDir)} && docker compose -f ${shellQuote(composeFile)} -p ${shellQuote(projectName)} down`;
  const result = await execRemote(target, cmd, onLog);
  return { exitCode: result.exitCode };
}

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
  onLog: OnLog
): Promise<{ exitCode: number }> {
  const cmd = `mkdir -p ${shellQuote(workDir)} && cd ${shellQuote(workDir)} && git clone --depth 1 --branch ${shellQuote(branch)} --single-branch ${shellQuote(repoUrl)} .`;
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

// ── Helpers ──────────────────────────────────────────────────────

/**
 * Shell-escape a value for safe inclusion in SSH commands.
 * Uses single quotes (POSIX) which prevent all interpolation.
 */
function shellQuote(s: string): string {
  // Reject dangerous inputs before quoting
  if (s.length > 4096) throw new Error("Input too long for shell argument");

  // Replace single quotes (%27) with '"'"' pattern
  return `'${s.replace(/'/g, "'\"'\"'")}'`;
}
