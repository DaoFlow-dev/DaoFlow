import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";

import { parseEnvFile } from "./templates";
import {
  assertRecoveryDatabaseEvidence,
  buildRecoveryEvidenceSql
} from "./control-plane-recovery-restore-evidence";
import type {
  RecoveryDatabaseEvidence,
  RecoveryMigrationEntry,
  RecoveryRestoreRuntime
} from "./control-plane-recovery-restore-types";

export type {
  RecoveryDatabaseEvidence,
  RecoveryMigrationEntry,
  RecoveryRestoreRuntime
} from "./control-plane-recovery-restore-types";

const POSTGRES_IDENTIFIER = /^[A-Za-z_][A-Za-z0-9_]{0,62}$/;

const MIGRATION_JOURNAL_SQL =
  "SELECT COALESCE(json_agg(json_build_object('hash', hash, 'createdAt', created_at) ORDER BY created_at), '[]'::json)::text FROM drizzle.__drizzle_migrations;";
export const recoveryRestoreRuntime: RecoveryRestoreRuntime = {
  execFile: (command, args, options) =>
    execFileSync(command, [...args], {
      cwd: options.cwd,
      env: options.env,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "pipe"],
      maxBuffer: 16 * 1024 * 1024
    }),
  fetch: (input, init) => globalThis.fetch(input, init),
  sleep: (ms) => new Promise((resolve) => setTimeout(resolve, ms)),
  now: () => new Date()
};

function assertIdentifier(value: string): void {
  if (!POSTGRES_IDENTIFIER.test(value)) {
    throw new Error("Recovery database name is invalid.");
  }
}

function composeEnvironment(
  envPath: string,
  overrides: Record<string, string> = {}
): NodeJS.ProcessEnv {
  return {
    ...process.env,
    ...parseEnvFile(readFileSync(envPath, "utf8")),
    ...overrides
  };
}

function runDocker(
  runtime: RecoveryRestoreRuntime,
  args: readonly string[],
  input: { dir?: string; env?: NodeJS.ProcessEnv } = {}
): string {
  return runtime.execFile("docker", args, { cwd: input.dir, env: input.env }).trim();
}

function runCompose(input: {
  runtime: RecoveryRestoreRuntime;
  dir: string;
  envPath: string;
  args: readonly string[];
  envOverrides?: Record<string, string>;
}): string {
  return runDocker(input.runtime, ["compose", "--env-file", input.envPath, ...input.args], {
    dir: input.dir,
    env: composeEnvironment(input.envPath, input.envOverrides)
  });
}

export function getComposeContainerId(input: {
  runtime: RecoveryRestoreRuntime;
  dir: string;
  envPath: string;
  service: "daoflow" | "postgres";
}): string {
  return runCompose({ ...input, args: ["ps", "-q", input.service] });
}

export function isContainerRunning(runtime: RecoveryRestoreRuntime, containerId: string): boolean {
  if (!containerId) return false;
  return runDocker(runtime, ["inspect", "--format", "{{.State.Running}}", containerId]) === "true";
}

export function requireRecoveryPostgres(input: {
  runtime: RecoveryRestoreRuntime;
  dir: string;
  envPath: string;
}): string {
  const containerId = getComposeContainerId({ ...input, service: "postgres" });
  if (!containerId || !isContainerRunning(input.runtime, containerId)) {
    throw new Error("The clean installation PostgreSQL service must be running.");
  }
  return containerId;
}

export function stopRecoveryControlPlane(input: {
  runtime: RecoveryRestoreRuntime;
  dir: string;
  envPath: string;
}): void {
  runCompose({ ...input, args: ["stop", "daoflow"] });
  const containerId = getComposeContainerId({ ...input, service: "daoflow" });
  if (containerId && isContainerRunning(input.runtime, containerId)) {
    throw new Error("DaoFlow did not enter offline recovery mode.");
  }
}

export function startRecoveryControlPlane(input: {
  runtime: RecoveryRestoreRuntime;
  dir: string;
  envPath: string;
}): void {
  runCompose({ ...input, args: ["up", "-d", "--no-deps", "--force-recreate", "daoflow"] });
}

function postgresCommand(input: {
  runtime: RecoveryRestoreRuntime;
  containerId: string;
  database: string;
  sql: string;
}): string {
  assertIdentifier(input.database);
  return runDocker(input.runtime, [
    "exec",
    input.containerId,
    "psql",
    "--username",
    "daoflow",
    "--dbname",
    input.database,
    "--tuples-only",
    "--no-align",
    "--quiet",
    "--no-psqlrc",
    "--set=ON_ERROR_STOP=1",
    "--command",
    input.sql
  ]);
}

export function recoveryDatabaseExists(input: {
  runtime: RecoveryRestoreRuntime;
  containerId: string;
  databaseName: string;
}): boolean {
  assertIdentifier(input.databaseName);
  return (
    postgresCommand({
      runtime: input.runtime,
      containerId: input.containerId,
      database: "postgres",
      sql: `SELECT 1 FROM pg_database WHERE datname = '${input.databaseName}';`
    }) === "1"
  );
}

export function readRecoveryPostgresVersion(input: {
  runtime: RecoveryRestoreRuntime;
  containerId: string;
}): string {
  const version = postgresCommand({
    runtime: input.runtime,
    containerId: input.containerId,
    database: "postgres",
    sql: "SHOW server_version;"
  });
  const numericVersion = version.match(/^\d+(?:\.\d+)*/)?.[0];
  if (!numericVersion) {
    throw new Error("The clean installation PostgreSQL version could not be verified.");
  }
  return numericVersion;
}

export function createRecoveryDatabase(input: {
  runtime: RecoveryRestoreRuntime;
  containerId: string;
  databaseName: string;
}): void {
  assertIdentifier(input.databaseName);
  if (recoveryDatabaseExists(input)) {
    throw new Error(
      `Recovery database ${input.databaseName} already exists; refusing to overwrite it.`
    );
  }
  runDocker(input.runtime, [
    "exec",
    input.containerId,
    "createdb",
    "--username",
    "daoflow",
    "--maintenance-db",
    "postgres",
    input.databaseName
  ]);
}

export function restoreRecoveryDump(input: {
  runtime: RecoveryRestoreRuntime;
  containerId: string;
  databaseName: string;
  dumpPath: string;
  bundleId: string;
}): void {
  assertIdentifier(input.databaseName);
  const safeBundleId = input.bundleId.replace(/[^A-Za-z0-9_-]/g, "").slice(0, 32);
  const containerDumpPath = `/tmp/daoflow-recovery-${safeBundleId || "bundle"}.dump`;
  try {
    runDocker(input.runtime, ["cp", input.dumpPath, `${input.containerId}:${containerDumpPath}`]);
    runDocker(input.runtime, [
      "exec",
      input.containerId,
      "pg_restore",
      "--format=custom",
      "--exit-on-error",
      "--no-owner",
      "--no-privileges",
      "--username",
      "daoflow",
      "--dbname",
      input.databaseName,
      containerDumpPath
    ]);
  } finally {
    try {
      runDocker(input.runtime, ["exec", input.containerId, "rm", "-f", containerDumpPath]);
    } catch {
      // The disposable container copy contains only the already encrypted bundle payload.
    }
  }
}

export function readRecoveryMigrationJournal(input: {
  runtime: RecoveryRestoreRuntime;
  containerId: string;
  databaseName: string;
}): RecoveryMigrationEntry[] {
  const value = JSON.parse(
    postgresCommand({ ...input, database: input.databaseName, sql: MIGRATION_JOURNAL_SQL })
  ) as unknown;
  if (!Array.isArray(value)) throw new Error("Restored migration journal is invalid.");
  return value as RecoveryMigrationEntry[];
}

export function readRecoveryDatabaseEvidence(input: {
  runtime: RecoveryRestoreRuntime;
  containerId: string;
  databaseName: string;
  verificationEmail: string;
}): RecoveryDatabaseEvidence {
  return assertRecoveryDatabaseEvidence(
    JSON.parse(
      postgresCommand({
        ...input,
        database: input.databaseName,
        sql: buildRecoveryEvidenceSql(input.verificationEmail)
      })
    ) as unknown
  );
}

export function runRecoveryMigrations(input: {
  runtime: RecoveryRestoreRuntime;
  dir: string;
  envPath: string;
  databaseUrl: string;
  externalSecrets: Record<string, string>;
}): void {
  const envOverrides = {
    ...input.externalSecrets,
    DATABASE_URL: input.databaseUrl,
    DAOFLOW_RUN_MIGRATIONS_ONLY: "true"
  };
  const passThroughNames = Object.keys(envOverrides).sort();
  runCompose({
    runtime: input.runtime,
    dir: input.dir,
    envPath: input.envPath,
    envOverrides,
    args: [
      "run",
      "--rm",
      "--no-deps",
      ...passThroughNames.flatMap((name) => ["-e", name]),
      "daoflow"
    ]
  });
}

export const recoveryRestoreRuntimeTestHooks = {
  composeEnvironment,
  postgresIdentifierPattern: POSTGRES_IDENTIFIER,
  migrationJournalSql: MIGRATION_JOURNAL_SQL,
  buildRecoveryEvidenceSql
};
