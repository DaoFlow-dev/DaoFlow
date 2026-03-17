import { eq } from "drizzle-orm";
import { db } from "../connection";
import { servers } from "../schema/servers";
import { decrypt } from "../crypto";
import { detectLocalRuntimeVersions, type OnLog } from "../../worker/docker-executor";
import {
  detectDockerVersion,
  removeSSHKey,
  testSSHConnection,
  writeSSHKey
} from "../../worker/ssh-executor";

function isLocalHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return normalized === "localhost" || normalized === "127.0.0.1" || normalized === "::1";
}

function createLogSink(): OnLog {
  return () => {};
}

export async function verifyServerReadiness(server: typeof servers.$inferSelect) {
  const checkedAt = new Date();
  const issues: string[] = [];
  const recommendedActions: string[] = [];
  let sshReachable = false;
  let dockerReachable = false;
  let composeReachable = false;
  let latencyMs: number | null = null;
  let dockerVersion: string | null = null;
  let composeVersion: string | null = null;

  const onLog = createLogSink();

  if (isLocalHost(server.host)) {
    const versions = await detectLocalRuntimeVersions(onLog);
    dockerVersion = versions.docker ?? null;
    composeVersion = versions.compose ?? null;
    sshReachable = true;
    dockerReachable = Boolean(dockerVersion);
    composeReachable = Boolean(composeVersion);
    latencyMs = 0;

    if (!dockerReachable) {
      issues.push("Docker Engine is not reachable on the control-plane host.");
      recommendedActions.push("Start Docker locally before scheduling workloads on localhost.");
    }
    if (!composeReachable) {
      issues.push("Docker Compose CLI is not available on the control-plane host.");
      recommendedActions.push("Install or enable `docker compose` on the control-plane host.");
    }
  } else if (!server.sshPrivateKeyEncrypted) {
    issues.push("No SSH private key is stored for this server.");
    recommendedActions.push("Add a per-server SSH user and private key before deploying.");
  } else {
    const keyPath = writeSSHKey(server.name, decrypt(server.sshPrivateKeyEncrypted));

    try {
      const target = {
        serverName: server.name,
        host: server.host,
        port: server.sshPort,
        user: server.sshUser ?? undefined,
        privateKeyPath: keyPath
      };

      const ssh = await testSSHConnection(target, onLog);
      sshReachable = ssh.reachable;
      latencyMs = ssh.latencyMs;

      if (!ssh.reachable) {
        issues.push(ssh.error ?? "SSH handshake failed.");
        recommendedActions.push(
          "Verify the host, port, SSH user, and private key for this server."
        );
      } else {
        const versions = await detectDockerVersion(target, onLog);
        dockerVersion = versions.docker ?? null;
        composeVersion = versions.compose ?? null;
        dockerReachable = Boolean(dockerVersion);
        composeReachable = Boolean(composeVersion);

        if (!dockerReachable) {
          issues.push("Docker Engine is reachable over SSH, but no server version was detected.");
          recommendedActions.push("Install Docker Engine and confirm the SSH user can run Docker.");
        }
        if (!composeReachable) {
          issues.push("Docker Compose is not available for the configured SSH user.");
          recommendedActions.push("Install the Docker Compose plugin on the target server.");
        }
      }
    } finally {
      removeSSHKey(keyPath);
    }
  }

  if (issues.length === 0) {
    recommendedActions.push("No action required.");
  }

  const readinessStatus =
    sshReachable && dockerReachable && composeReachable ? "ready" : "attention";
  const nextMetadata =
    server.metadata && typeof server.metadata === "object" && !Array.isArray(server.metadata)
      ? { ...(server.metadata as Record<string, unknown>) }
      : {};

  nextMetadata.readinessCheck = {
    readinessStatus,
    sshReachable,
    dockerReachable,
    composeReachable,
    latencyMs,
    checkedAt: checkedAt.toISOString(),
    issues,
    recommendedActions
  };

  const [updated] = await db
    .update(servers)
    .set({
      status: readinessStatus,
      dockerVersion,
      composeVersion,
      metadata: nextMetadata,
      lastCheckedAt: checkedAt,
      updatedAt: checkedAt
    })
    .where(eq(servers.id, server.id))
    .returning();

  return updated;
}
