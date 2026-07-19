import { createHash } from "node:crypto";
import { readFileSync, statSync } from "node:fs";

import { inspectControlPlaneRecoveryRestoreBundle } from "./control-plane-recovery-restore-bundle";
import {
  assertRecoveryDatabaseIdentifier,
  confirmControlPlaneRecoveryRestoreTarget,
  controlPlaneRecoveryRestorePlanDependencies,
  createRecoveryExecutionFingerprints,
  readControlPlaneRecoveryInstallation,
  type RecoveryRestorePlanDependencies
} from "./control-plane-recovery-restore-preflight";
import { assertSemanticVersionCompatibility } from "./control-plane-recovery-restore-semver";
import type {
  ControlPlaneRecoveryManifest,
  ControlPlaneRecoveryRestoreInspection,
  ControlPlaneRecoveryRestorePlan,
  RecoveryBundleInspection
} from "./control-plane-recovery-restore-types";
import { parseEnvFile } from "./templates";

const RECOVERY_KEY = "DAOFLOW_RECOVERY_ENCRYPTION_KEY";
const VERIFY_EMAIL = "DAOFLOW_RECOVERY_VERIFY_EMAIL";
const VERIFY_PASSWORD = "DAOFLOW_RECOVERY_VERIFY_PASSWORD";
const RESERVED_DATABASES = new Set(["daoflow", "postgres", "template0", "template1"]);

export interface InspectControlPlaneRecoveryRestoreInput {
  bundlePath: string;
  sidecarPath: string;
  secretsPath: string;
  installDir: string;
  targetDatabase?: string;
  databaseName?: string;
  workspaceRoot?: string;
}

export function readControlPlaneRecoverySecrets(secretsPath: string): Record<string, string> {
  let mode: number;
  let contents: string;
  try {
    const stat = statSync(secretsPath);
    if (!stat.isFile()) throw new Error("not-file");
    mode = stat.mode;
    contents = readFileSync(secretsPath, "utf8");
  } catch {
    throw new Error("Recovery secrets file is unavailable.");
  }
  if ((mode & 0o077) !== 0) {
    throw new Error("Recovery secrets file must not be accessible by group or other users.");
  }
  return parseEnvFile(contents);
}

/**
 * Completes all restore preflight checks and returns an extracted dump for the executor.
 * Secret values are held only in `secrets`; the returned plan contains only safe keyed fingerprints.
 */
export async function inspectControlPlaneRecoveryRestore(
  input: InspectControlPlaneRecoveryRestoreInput,
  dependencies: RecoveryRestorePlanDependencies = controlPlaneRecoveryRestorePlanDependencies
): Promise<ControlPlaneRecoveryRestoreInspection> {
  const parsedSecrets = readControlPlaneRecoverySecrets(input.secretsPath);
  const recoveryKey = parsedSecrets[RECOVERY_KEY]?.trim();
  if (!recoveryKey) throw new Error(`${RECOVERY_KEY} is required in the recovery secrets file.`);

  const bundle = await inspectControlPlaneRecoveryRestoreBundle({
    bundlePath: input.bundlePath,
    sidecarPath: input.sidecarPath,
    recoveryKey,
    workspaceRoot: input.workspaceRoot
  });
  try {
    const installation = readControlPlaneRecoveryInstallation(input.installDir);
    assertSemanticVersionCompatibility(
      installation.version,
      bundle.manifest.compatibility.minimumAppVersion,
      bundle.manifest.compatibility.maximumAppVersionExclusive
    );
    const requiredExternalSecrets = requiredSecretNames(bundle.manifest);
    const secrets = selectRequiredSecrets(parsedSecrets, requiredExternalSecrets);
    const newDatabase = resolveTargetDatabase(
      input,
      bundle.manifest.bundleId,
      installation.oldDatabase
    );
    const target = confirmControlPlaneRecoveryRestoreTarget({
      installDir: input.installDir,
      manifest: bundle.manifest,
      newDatabase,
      dependencies
    });
    const plan = createControlPlaneRecoveryRestorePlan({
      bundle,
      installDir: input.installDir,
      installedVersion: installation.version,
      oldDatabase: installation.oldDatabase,
      newDatabase,
      requiredExternalSecrets,
      verificationEmail: secrets[VERIFY_EMAIL],
      recoveryKey,
      secrets,
      postgresPassword: installation.postgresPassword,
      environmentContents: installation.environmentContents,
      composeContents: installation.composeContents,
      targetPostgresVersion: target.postgresVersion
    });
    return { ...bundle, plan, secrets };
  } catch (error) {
    await bundle.cleanup();
    throw error;
  }
}

export const planControlPlaneRecoveryRestore = inspectControlPlaneRecoveryRestore;

export function createControlPlaneRecoveryRestorePlan(input: {
  bundle: RecoveryBundleInspection;
  installDir: string;
  installedVersion: string;
  oldDatabase: string;
  newDatabase: string;
  requiredExternalSecrets: string[];
  verificationEmail: string;
  recoveryKey: string;
  secrets: Readonly<Record<string, string>>;
  postgresPassword: string;
  environmentContents: string;
  composeContents: string;
  targetPostgresVersion: string;
}): ControlPlaneRecoveryRestorePlan {
  const manifest = input.bundle.manifest;
  const executionFingerprints = createRecoveryExecutionFingerprints(input);
  const checks = [
    passed(
      "signed-bundle",
      "Signed sidecar, bundle checksum, and encryption authentication verified."
    ),
    passed(
      "inner-manifest",
      "Encrypted manifest identity and PostgreSQL custom-dump checksum verified."
    ),
    passed(
      "app-version",
      `Installed version ${input.installedVersion} is within the bundle compatibility range.`
    ),
    passed(
      "compose-database-override",
      "The installation compose file supports DAOFLOW_DATABASE_NAME."
    ),
    passed(
      "external-secrets",
      "All required external secret names are present in the protected secrets file."
    ),
    passed(
      "execution-input-fingerprints",
      "Keyed fingerprints bind execution-critical secrets and installation configuration."
    ),
    passed(
      "target-postgres-version",
      `Target PostgreSQL ${input.targetPostgresVersion} is compatible with the recovery bundle.`
    ),
    passed(
      "database-target-nonexistent",
      `The recovery database does not exist: ${input.newDatabase}.`
    )
  ];
  const steps = [
    step(
      "preflight",
      "Confirm target PostgreSQL compatibility and that the recovery database is absent before stopping DaoFlow."
    ),
    step("offline", "Stop the DaoFlow service while leaving PostgreSQL running."),
    step("create-database", `Refuse an existing database, then create ${input.newDatabase}.`),
    step("restore-dump", "Restore the authenticated PostgreSQL custom dump into the new database."),
    step("migrate", "Run DaoFlow migrations against the new database only."),
    step(
      "switch",
      `Preserve the old config, then atomically set DAOFLOW_DATABASE_NAME from ${input.oldDatabase} to ${input.newDatabase}.`
    ),
    step("restart", "Force-recreate DaoFlow so it reads the recovered database configuration."),
    step(
      "verify",
      `Verify readiness and sign in as ${input.verificationEmail}, then read projects, servers, audit history, and backups.`
    ),
    step("rollback", "Restore the previous config automatically if post-start verification fails.")
  ];
  const unsigned: Omit<ControlPlaneRecoveryRestorePlan, "planHash"> = {
    version: 1,
    bundle: {
      id: manifest.bundleId,
      sha256: input.bundle.bundle.sha256,
      databaseSha256: manifest.database.sha256,
      appVersion: manifest.appVersion,
      schemaVersion: manifest.schemaVersion,
      createdAt: manifest.createdAt,
      keyFingerprint: manifest.recoveryKey.fingerprint
    },
    installation: { directory: input.installDir, version: input.installedVersion },
    databases: { oldDatabase: input.oldDatabase, newDatabase: input.newDatabase },
    preflight: {
      keyedFingerprintAlgorithm: "hmac-sha256",
      ...executionFingerprints,
      targetPostgresVersion: input.targetPostgresVersion,
      targetDatabaseDoesNotExist: true
    },
    requiredExternalSecrets: [...input.requiredExternalSecrets],
    verification: { email: input.verificationEmail },
    checks,
    steps
  };
  return {
    ...unsigned,
    planHash: createHash("sha256").update(JSON.stringify(unsigned)).digest("hex")
  };
}

function requiredSecretNames(manifest: ControlPlaneRecoveryManifest): string[] {
  return [
    ...new Set([...manifest.requiredExternalSecrets, RECOVERY_KEY, VERIFY_EMAIL, VERIFY_PASSWORD])
  ].sort();
}

function selectRequiredSecrets(
  parsed: Record<string, string>,
  names: readonly string[]
): Readonly<Record<string, string>> {
  const missing = names.filter((name) => !parsed[name]?.trim());
  if (missing.length > 0) {
    throw new Error(`Recovery secrets file is missing required values: ${missing.join(", ")}.`);
  }
  return Object.freeze(Object.fromEntries(names.map((name) => [name, parsed[name]])));
}

function resolveTargetDatabase(
  input: InspectControlPlaneRecoveryRestoreInput,
  bundleId: string,
  oldDatabase: string
): string {
  if (input.targetDatabase && input.databaseName && input.targetDatabase !== input.databaseName) {
    throw new Error("Only one recovery database override may be supplied.");
  }
  const candidate = (
    input.targetDatabase ??
    input.databaseName ??
    `daoflow_recovery_${bundleId.replaceAll("-", "_")}`
  ).trim();
  assertRecoveryDatabaseIdentifier(candidate, "Recovery database");
  if (
    candidate.toLowerCase() === oldDatabase.toLowerCase() ||
    RESERVED_DATABASES.has(candidate.toLowerCase())
  ) {
    throw new Error("Recovery database must be a new, non-reserved PostgreSQL identifier.");
  }
  return candidate;
}

function passed(id: string, detail: string) {
  return { id, status: "passed" as const, detail };
}

function step(id: string, detail: string) {
  return { id, action: id.replaceAll("-", " "), detail };
}
