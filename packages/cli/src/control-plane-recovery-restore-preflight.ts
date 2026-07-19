import { createHmac } from "node:crypto";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import { parse as parseYaml } from "yaml";

import {
  readRecoveryPostgresVersion,
  recoveryDatabaseExists,
  recoveryRestoreRuntime,
  requireRecoveryPostgres
} from "./control-plane-recovery-restore-runtime";
import {
  isRecoveryRecord,
  type ControlPlaneRecoveryManifest
} from "./control-plane-recovery-restore-types";
import { parseEnvFile } from "./templates";

const FINGERPRINT_CONTEXT = "daoflow-control-plane-recovery-restore-plan-v1";
const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;
const parseYamlUnknown: (source: string) => unknown = parseYaml;

export const controlPlaneRecoveryRestorePlanDependencies = {
  requirePostgres: requireRecoveryPostgres,
  readPostgresVersion: readRecoveryPostgresVersion,
  databaseExists: recoveryDatabaseExists
};

export type RecoveryRestorePlanDependencies = typeof controlPlaneRecoveryRestorePlanDependencies;

export type RecoveryRestoreInstallation = {
  version: string;
  oldDatabase: string;
  postgresPassword: string;
  environmentContents: string;
  composeContents: string;
};

export function readControlPlaneRecoveryInstallation(
  installDir: string
): RecoveryRestoreInstallation {
  let env: Record<string, string>;
  let compose: unknown;
  let environmentContents: string;
  let composeContents: string;
  try {
    environmentContents = readFileSync(join(installDir, ".env"), "utf8");
    composeContents = readFileSync(join(installDir, "docker-compose.yml"), "utf8");
    env = parseEnvFile(environmentContents);
    compose = parseYamlUnknown(composeContents);
  } catch {
    throw new Error("DaoFlow installation .env or docker-compose.yml is unavailable.");
  }
  const daoflow = service(compose, "daoflow");
  const databaseUrl = environmentValue(daoflow.environment, "DATABASE_URL");
  if (!databaseUrl?.includes("DAOFLOW_DATABASE_NAME")) {
    throw new Error("The installed docker-compose.yml does not support DAOFLOW_DATABASE_NAME.");
  }
  const version = env.DAOFLOW_VERSION?.trim() || composeVersion(daoflow.image);
  if (!version) throw new Error("Unable to determine the installed DaoFlow version.");
  const oldDatabase = (env.DAOFLOW_DATABASE_NAME || "daoflow").trim();
  assertRecoveryDatabaseIdentifier(oldDatabase, "Current recovery database");
  const postgresPassword = env.POSTGRES_PASSWORD?.trim();
  if (!postgresPassword) {
    throw new Error("The clean installation POSTGRES_PASSWORD is unavailable.");
  }
  return { version, oldDatabase, postgresPassword, environmentContents, composeContents };
}

export function confirmControlPlaneRecoveryRestoreTarget(input: {
  installDir: string;
  manifest: ControlPlaneRecoveryManifest;
  newDatabase: string;
  dependencies: RecoveryRestorePlanDependencies;
}): { postgresVersion: string; databaseDoesNotExist: true } {
  const runtime = recoveryRestoreRuntime;
  const containerId = input.dependencies.requirePostgres({
    runtime,
    dir: input.installDir,
    envPath: join(input.installDir, ".env")
  });
  const postgresVersion = input.dependencies.readPostgresVersion({ runtime, containerId });
  assertPostgresCompatibility(input.manifest.database.version, postgresVersion);
  if (
    input.dependencies.databaseExists({
      runtime,
      containerId,
      databaseName: input.newDatabase
    })
  ) {
    throw new Error(
      `Recovery database ${input.newDatabase} already exists; refusing to overwrite it.`
    );
  }
  return { postgresVersion, databaseDoesNotExist: true };
}

export function createRecoveryExecutionFingerprints(input: {
  recoveryKey: string;
  requiredExternalSecrets: readonly string[];
  secrets: Readonly<Record<string, string>>;
  postgresPassword: string;
  environmentContents: string;
  composeContents: string;
}): {
  executionSecretFingerprints: Record<string, string>;
  installationEnvDigest: string;
  composeDigest: string;
} {
  const values: Record<string, string> = {
    ...input.secrets,
    POSTGRES_PASSWORD: input.postgresPassword
  };
  const names = [...new Set([...input.requiredExternalSecrets, "POSTGRES_PASSWORD"])].sort();
  const executionSecretFingerprints = Object.fromEntries(
    names.map((name) => {
      const value = values[name];
      if (!value) throw new Error(`Execution-critical secret ${name} is unavailable.`);
      return [name, keyedFingerprint(input.recoveryKey, `secret:${name}`, value)];
    })
  );
  return {
    executionSecretFingerprints,
    installationEnvDigest: keyedFingerprint(
      input.recoveryKey,
      "installation-env",
      input.environmentContents
    ),
    composeDigest: keyedFingerprint(input.recoveryKey, "compose", input.composeContents)
  };
}

export function assertRecoveryDatabaseIdentifier(value: string, label: string): void {
  if (!POSTGRES_IDENTIFIER.test(value)) throw new Error(`${label} name is invalid.`);
}

function service(compose: unknown, name: string): Record<string, unknown> {
  if (
    !isRecoveryRecord(compose) ||
    !isRecoveryRecord(compose.services) ||
    !isRecoveryRecord(compose.services[name])
  ) {
    throw new Error("The installed docker-compose.yml does not define the DaoFlow service.");
  }
  return compose.services[name];
}

function environmentValue(value: unknown, name: string): string | null {
  if (isRecoveryRecord(value)) return typeof value[name] === "string" ? value[name] : null;
  if (!Array.isArray(value)) return null;
  const entry = value.find(
    (item): item is string => typeof item === "string" && item.startsWith(`${name}=`)
  );
  return entry?.slice(name.length + 1) ?? null;
}

function composeVersion(image: unknown): string | null {
  if (typeof image !== "string") return null;
  const defaultMatch = image.match(/:\$\{DAOFLOW_VERSION:-([^}]+)\}$/);
  if (defaultMatch) return defaultMatch[1] ?? null;
  const tagMatch = image.match(/:([^/:]+)$/);
  return tagMatch?.[1] ?? null;
}

function assertPostgresCompatibility(sourceVersion: string, targetVersion: string): void {
  const sourceMajor = postgresMajorVersion(sourceVersion, "Recovery bundle PostgreSQL version");
  const targetMajor = postgresMajorVersion(targetVersion, "Clean installation PostgreSQL version");
  if (sourceMajor !== targetMajor) {
    throw new Error(
      `PostgreSQL major version mismatch: bundle ${sourceVersion}, clean installation ${targetVersion}.`
    );
  }
}

function postgresMajorVersion(value: string, label: string): string {
  const match = value.match(/^(0|[1-9]\d*)(?:\.(0|[1-9]\d*))*$/);
  if (!match?.[1]) throw new Error(`${label} is invalid.`);
  return match[1];
}

function keyedFingerprint(key: string, label: string, value: string): string {
  return createHmac("sha256", key)
    .update(FINGERPRINT_CONTEXT)
    .update("\0")
    .update(label)
    .update("\0")
    .update(value)
    .digest("hex");
}
