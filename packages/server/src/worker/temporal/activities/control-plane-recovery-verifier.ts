import { createHash } from "node:crypto";

import { dockerCapture } from "./control-plane-recovery-docker-runner";

const READINESS_TIMEOUT_MS = 30_000;
const CONTAINER_NAME_PATTERN = /^[A-Za-z0-9][A-Za-z0-9_.-]{0,127}$/;
const POSTGRES_IDENTIFIER_PATTERN = /^[A-Za-z_][A-Za-z0-9_$]{0,62}$/;
export const DEFAULT_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB = 4 * 1024;
export const MIN_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB = 512;
export const MAX_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB = 64 * 1024;

export interface RecoveryVerificationContainer {
  name: string;
  databaseName: string;
  databaseUser: string;
}

export function getControlPlaneRecoveryVerifierStorageMb(
  env: NodeJS.ProcessEnv = process.env
): number {
  const raw = env.DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB?.trim();
  if (!raw) return DEFAULT_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB;

  const storageMb = Number(raw);
  if (
    !Number.isInteger(storageMb) ||
    storageMb < MIN_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB ||
    storageMb > MAX_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB
  ) {
    throw new Error(
      "DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB must be an integer between " +
        `${MIN_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB} and ${MAX_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB}.`
    );
  }
  return storageMb;
}

export function makeRecoveryVerificationContainer(
  bundleId: string,
  suffix: "prepare" | "verify"
): RecoveryVerificationContainer {
  const digest = createHash("sha256").update(`${bundleId}:${suffix}`).digest("hex").slice(0, 20);
  return {
    name: `daoflow-cpr-${suffix}-${digest}`,
    databaseName: `cpr_${suffix}_${digest}`,
    databaseUser: `cpr_user_${digest}`
  };
}

export function createRecoveryVerifierArgs(
  image: string,
  container: RecoveryVerificationContainer,
  bundleId: string
): string[] {
  assertContainerName(container.name);
  assertPostgresIdentifier(container.databaseName);
  assertPostgresIdentifier(container.databaseUser);
  const storageMb = getControlPlaneRecoveryVerifierStorageMb();
  const storageLimit = `${storageMb}m`;
  return [
    "create",
    "--name",
    container.name,
    "--pull=never",
    "--network",
    "none",
    "--read-only",
    "--cap-drop",
    "ALL",
    "--cap-add",
    "CHOWN",
    "--cap-add",
    "DAC_OVERRIDE",
    "--cap-add",
    "FOWNER",
    "--cap-add",
    "SETGID",
    "--cap-add",
    "SETUID",
    "--security-opt",
    "no-new-privileges:true",
    "--pids-limit",
    "128",
    "--cpus",
    "1.0",
    "--memory",
    storageLimit,
    "--memory-swap",
    storageLimit,
    "--tmpfs",
    `/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=${storageLimit},mode=0700`,
    "--tmpfs",
    "/tmp:rw,nosuid,nodev,noexec,size=128m,mode=1777",
    "--tmpfs",
    "/var/run/postgresql:rw,nosuid,nodev,noexec,size=16m,mode=0775",
    "--label",
    "com.daoflow.control-plane-recovery=true",
    "--label",
    `com.daoflow.control-plane-recovery-bundle=${bundleId}`,
    "--label",
    "com.daoflow.cleanup=required",
    "--env",
    `POSTGRES_DB=${container.databaseName}`,
    "--env",
    `POSTGRES_USER=${container.databaseUser}`,
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "--env",
    "PGDATA=/var/lib/postgresql/data",
    image
  ];
}

export async function startAndWaitForRecoveryVerifier(
  container: RecoveryVerificationContainer,
  signal?: AbortSignal
): Promise<void> {
  await dockerCapture(["start", container.name], "start recovery verifier container", signal);
  const deadline = Date.now() + READINESS_TIMEOUT_MS;
  while (Date.now() < deadline) {
    try {
      await dockerCapture(
        [
          "exec",
          container.name,
          "pg_isready",
          "--username",
          container.databaseUser,
          "--dbname",
          container.databaseName,
          "--host",
          "127.0.0.1"
        ],
        "check recovery verifier readiness",
        signal
      );
      return;
    } catch {
      if (signal?.aborted) throw new Error("Control-plane recovery was cancelled.");
      await new Promise((resolve) => setTimeout(resolve, 250));
    }
  }
  throw new Error("Recovery verifier did not become ready in time.");
}

export async function removeRecoveryContainer(name: string): Promise<boolean> {
  try {
    await dockerCapture(["rm", "--force", name], "remove recovery verifier container");
    return true;
  } catch {
    return false;
  }
}

function assertContainerName(value: string): void {
  if (!CONTAINER_NAME_PATTERN.test(value)) {
    throw new Error("Control-plane PostgreSQL container name is invalid.");
  }
}

function assertPostgresIdentifier(value: string): void {
  if (!POSTGRES_IDENTIFIER_PATTERN.test(value)) {
    throw new Error("Control-plane PostgreSQL identifier is invalid.");
  }
}

export const controlPlaneRecoveryVerifierTestHooks = {
  createRecoveryVerifierArgs,
  getControlPlaneRecoveryVerifierStorageMb,
  makeRecoveryVerificationContainer
};
