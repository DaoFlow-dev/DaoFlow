import { spawn } from "node:child_process";
import { chmod, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import type { RealInfraConfig } from "./config";

const PRECHECK_TIMEOUT_MS = 30_000;
const TERM_GRACE_TIMEOUT_MS = 5_000;
const knownHostsScript = resolve("e2e/fixtures/real-infra/known-hosts.ts");

export function shellQuote(value: string) {
  return `'${value.replace(/'/g, "'\\''")}'`;
}

export class PinnedSshSession {
  private identityDirectory: string | null = null;
  private identityPath: string | null = null;

  constructor(private readonly config: RealInfraConfig) {}

  async start() {
    const directory = await mkdtemp(join(tmpdir(), "daoflow-real-infra-ssh-"));
    const identityPath = join(directory, "identity");
    await chmod(directory, 0o700);
    await writeFile(identityPath, `${this.config.ssh.privateKey.trim()}\n`, { mode: 0o600 });
    this.identityDirectory = directory;
    this.identityPath = identityPath;
  }

  async run(remoteCommand: string, timeoutMs = PRECHECK_TIMEOUT_MS, capture = false) {
    if (!this.identityPath) throw new Error("Pinned SSH session is not initialized.");
    return run("ssh", this.arguments(remoteCommand), timeoutMs, capture);
  }

  async verifyMarker() {
    const command = [
      "set -eu",
      `test -f ${shellQuote(this.config.ssh.markerPath)}`,
      `test \"$(cat ${shellQuote(this.config.ssh.markerPath)})\" = ${shellQuote(this.config.ssh.markerNonce)}`
    ].join("; ");
    await this.run(command);
  }

  async stop() {
    if (this.identityDirectory) {
      await rm(this.identityDirectory, { recursive: true, force: true });
      this.identityDirectory = null;
      this.identityPath = null;
    }
  }

  private arguments(remoteCommand: string) {
    if (!this.identityPath) throw new Error("Pinned SSH session is not initialized.");
    return [
      "-F",
      "/dev/null",
      "-T",
      "-o",
      "BatchMode=yes",
      "-o",
      "IdentitiesOnly=yes",
      "-o",
      "StrictHostKeyChecking=yes",
      "-o",
      "UserKnownHostsFile=/dev/null",
      "-o",
      "GlobalKnownHostsFile=/dev/null",
      "-o",
      "HostKeyAlias=daoflow-real-infra",
      "-o",
      `KnownHostsCommand=${process.execPath} ${knownHostsScript}`,
      "-o",
      "UpdateHostKeys=no",
      "-o",
      "ConnectTimeout=10",
      "-i",
      this.identityPath,
      "-p",
      String(this.config.ssh.port),
      `${this.config.ssh.user}@${this.config.ssh.host}`,
      remoteCommand
    ];
  }
}

export async function assertPinnedRemoteMarker(config: RealInfraConfig) {
  const session = new PinnedSshSession(config);
  try {
    await session.start();
    await session.verifyMarker();
  } finally {
    await session.stop();
  }
}

async function run(command: string, args: string[], timeoutMs: number, capture = false) {
  return await new Promise<string>((resolve, reject) => {
    const child = spawn(command, args, {
      env: process.env,
      stdio: ["ignore", capture ? "pipe" : "ignore", "ignore"]
    });
    let output = "";
    let settled = false;
    let childExited = false;
    let forceKillTimer: ReturnType<typeof setTimeout> | undefined;
    child.stdout?.on("data", (chunk: Buffer) => {
      output += chunk.toString("utf8");
    });

    const timer = setTimeout(
      () => {
        settleFailure(new Error(`Pinned SSH command timed out after ${timeoutMs}ms.`), false);
        terminateChild();
      },
      Math.min(timeoutMs, 600_000)
    );
    timer.unref?.();

    function clearForceKillTimer() {
      if (!forceKillTimer) return;
      clearTimeout(forceKillTimer);
      forceKillTimer = undefined;
    }

    function settleFailure(error: Error, clearForceKill = true) {
      if (settled) return;
      settled = true;
      clearTimeout(timer);
      if (clearForceKill) clearForceKillTimer();
      reject(error);
    }

    function terminateChild() {
      if (childExited || forceKillTimer) return;
      try {
        child.kill("SIGTERM");
      } catch {
        // The process may have exited between timeout handling and termination.
      }
      if (childExited) return;
      forceKillTimer = setTimeout(() => {
        forceKillTimer = undefined;
        if (childExited) return;
        try {
          child.kill("SIGKILL");
        } catch {
          // The process may already have exited.
        }
      }, TERM_GRACE_TIMEOUT_MS);
      forceKillTimer.unref?.();
    }

    child.once("error", () => {
      settleFailure(new Error("Pinned SSH command could not start."));
    });
    child.once("close", (code) => {
      childExited = true;
      clearForceKillTimer();
      clearTimeout(timer);
      if (settled) return;
      settled = true;
      if (code === 0) resolve(output);
      else reject(new Error(`${command} failed with exit code ${code ?? 1}.`));
    });
  });
}
