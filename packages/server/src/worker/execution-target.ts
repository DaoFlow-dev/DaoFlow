import type { servers } from "../db/schema/servers";
import { decrypt } from "../db/crypto";
import { removeSSHKey, type SSHTarget, writeSSHKey } from "./ssh-executor";
import { hostname } from "node:os";

export type ExecutionTarget =
  | {
      mode: "local";
      serverKind?: string;
    }
  | {
      mode: "remote";
      ssh: SSHTarget;
      remoteWorkDir: string;
      serverKind?: string;
    };

const REMOTE_STAGING_ROOT = process.env.REMOTE_GIT_WORK_DIR ?? "/tmp/daoflow-staging";

/** Cached hostname — resolved once at module load. */
const localHostname = hostname().toLowerCase();

function isLocalHost(host: string): boolean {
  const normalized = host.trim().toLowerCase();
  return (
    normalized === "localhost" ||
    normalized === "127.0.0.1" ||
    normalized === "::1" ||
    normalized === "host.docker.internal" ||
    normalized === localHostname
  );
}

export function resolveExecutionTarget(
  server: typeof servers.$inferSelect,
  deploymentId: string
): ExecutionTarget {
  if (isLocalHost(server.host)) {
    return {
      mode: "local",
      serverKind: server.kind
    };
  }

  return {
    mode: "remote",
    serverKind: server.kind,
    ssh: {
      serverName: server.name,
      host: server.host,
      port: server.sshPort,
      user: server.sshUser ?? undefined,
      privateKey: server.sshPrivateKeyEncrypted ? decrypt(server.sshPrivateKeyEncrypted) : undefined
    },
    remoteWorkDir: `${REMOTE_STAGING_ROOT}/${deploymentId}`
  };
}

export async function withPreparedExecutionTarget<T>(
  target: ExecutionTarget,
  run: (target: ExecutionTarget) => Promise<T>
): Promise<T> {
  if (target.mode !== "remote" || !target.ssh.privateKey) {
    return run(target);
  }

  const keyPath = writeSSHKey(target.ssh.serverName, target.ssh.privateKey);

  try {
    return await run({
      ...target,
      ssh: {
        ...target.ssh,
        privateKeyPath: keyPath
      }
    });
  } finally {
    removeSSHKey(keyPath);
  }
}
