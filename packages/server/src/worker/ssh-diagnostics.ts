import type { OnLog } from "./docker-executor";
import { execRemote, type SSHTarget } from "./ssh-connection";

/** Test SSH connectivity and return stable readiness diagnostics. */
export async function testSSHConnection(
  target: SSHTarget,
  onLog: OnLog
): Promise<{ reachable: boolean; latencyMs: number; error?: string }> {
  const start = Date.now();
  const stderr: string[] = [];
  try {
    const result = await execRemote(target, "echo daoflow-ping", (line) => {
      onLog(line);
      if (line.stream === "stderr") stderr.push(line.message);
    });
    const latencyMs = Date.now() - start;
    return {
      reachable: result.exitCode === 0,
      latencyMs,
      error:
        result.exitCode !== 0
          ? classifySshFailure(stderr, `SSH exited with code ${result.exitCode}`)
          : undefined
    };
  } catch (err) {
    return {
      reachable: false,
      latencyMs: Date.now() - start,
      error: err instanceof Error ? err.message : String(err)
    };
  }
}

function classifySshFailure(stderr: string[], fallback: string): string {
  const message = stderr.join(" ").toLowerCase();
  if (message.includes("invalid format") || message.includes("error in libcrypto")) {
    return "The configured SSH private key format is invalid.";
  }
  if (message.includes("permission denied")) {
    return "The SSH server denied authentication for the configured user and key.";
  }
  if (
    message.includes("host key verification failed") ||
    message.includes("remote host identification")
  ) {
    return "SSH host-key verification failed for the approved identity.";
  }
  if (message.includes("connection refused") || message.includes("operation timed out")) {
    return "The SSH endpoint could not be reached.";
  }
  if (message.includes("too long for unix domain socket")) {
    return "The SSH control-socket path exceeds the platform limit.";
  }
  return fallback;
}

/** Detect Docker and Compose versions on a remote server. */
export async function detectDockerVersion(
  target: SSHTarget,
  onLog: OnLog
): Promise<{ docker?: string; compose?: string }> {
  const versions: { docker?: string; compose?: string } = {};
  await execRemote(target, "docker version --format '{{.Server.Version}}'", (line) => {
    onLog(line);
    if (line.stream === "stdout" && line.message.match(/^\d+\.\d+/)) {
      versions.docker = line.message.trim();
    }
  });
  await execRemote(target, "docker compose version --short", (line) => {
    onLog(line);
    if (line.stream === "stdout" && line.message.match(/^\d+\.\d+/)) {
      versions.compose = line.message.trim();
    }
  });
  return versions;
}
