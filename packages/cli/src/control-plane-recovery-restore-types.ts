export const CONTROL_PLANE_RECOVERY_FORMAT_VERSION = 1 as const;
export const RECOVERY_SECRET_NAME = /^[A-Z][A-Z0-9_]*$/;
export const RECOVERY_SHA256 = /^[a-f0-9]{64}$/i;
export const RECOVERY_BUNDLE_ID = /^[A-Za-z0-9_-]{1,32}$/;

export function isRecoveryRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function isRecoveryString(value: unknown, pattern?: RegExp): value is string {
  return typeof value === "string" && value.length > 0 && (!pattern || pattern.test(value));
}

export function isRecoveryStringArray(value: unknown): value is string[] {
  return Array.isArray(value) && value.every((item) => typeof item === "string");
}

export interface ControlPlaneRecoveryCompatibility {
  minimumAppVersion: string;
  maximumAppVersionExclusive: string;
}

export function isRecoveryCompatibility(
  value: unknown
): value is ControlPlaneRecoveryCompatibility {
  return (
    isRecoveryRecord(value) &&
    isRecoveryString(value.minimumAppVersion) &&
    isRecoveryString(value.maximumAppVersionExclusive)
  );
}

export function isRecoverySecretList(value: unknown): value is string[] {
  return (
    isRecoveryStringArray(value) &&
    value.every((name) => RECOVERY_SECRET_NAME.test(name)) &&
    new Set(value).size === value.length
  );
}

export interface ControlPlaneRecoveryManifest {
  formatVersion: typeof CONTROL_PLANE_RECOVERY_FORMAT_VERSION;
  bundleId: string;
  appVersion: string;
  schemaVersion: string;
  createdAt: string;
  database: {
    engine: "postgres";
    version: string;
    dumpFormat: "postgres-custom";
    sha256: string;
  };
  migrations: {
    count: number;
    latestHash: string | null;
    applied: Array<{ hash: string; createdAt: number }>;
  };
  compatibility: ControlPlaneRecoveryCompatibility;
  requiredExternalSecrets: string[];
  recoveryKey: { fingerprint: string; rotatedAt: string | null };
  sanitization: { clearedFields: string[] };
  objects: { bundlePath: string; manifestPath: string; latestManifestPath: string };
}

export interface ControlPlaneRecoverySidecar {
  formatVersion: typeof CONTROL_PLANE_RECOVERY_FORMAT_VERSION;
  bundleId: string;
  appVersion: string;
  schemaVersion: string;
  createdAt: string;
  bundlePath: string;
  bundleSha256: string;
  keyFingerprint: string;
  compatibility: ControlPlaneRecoveryCompatibility;
  requiredExternalSecrets: string[];
}

export function assertControlPlaneRecoverySidecar(
  value: Record<string, unknown>
): ControlPlaneRecoverySidecar {
  if (
    value.formatVersion !== CONTROL_PLANE_RECOVERY_FORMAT_VERSION ||
    !isRecoveryString(value.bundleId, RECOVERY_BUNDLE_ID) ||
    !isRecoveryString(value.appVersion) ||
    !isRecoveryString(value.schemaVersion) ||
    !isRecoveryString(value.createdAt) ||
    !isRecoveryString(value.bundlePath) ||
    !isRecoveryString(value.bundleSha256, RECOVERY_SHA256) ||
    !isRecoveryString(value.keyFingerprint, RECOVERY_SHA256) ||
    !isRecoveryCompatibility(value.compatibility) ||
    !isRecoverySecretList(value.requiredExternalSecrets)
  ) {
    throw new Error("Recovery sidecar manifest is invalid.");
  }
  return value as unknown as ControlPlaneRecoverySidecar;
}

export function assertControlPlaneRecoveryManifest(value: unknown): ControlPlaneRecoveryManifest {
  if (!isRecoveryRecord(value)) throw new Error("Recovery bundle inner manifest is invalid.");
  const { database, migrations, recoveryKey, sanitization, objects } = value;
  if (
    value.formatVersion !== CONTROL_PLANE_RECOVERY_FORMAT_VERSION ||
    !isRecoveryString(value.bundleId, RECOVERY_BUNDLE_ID) ||
    !isRecoveryString(value.appVersion) ||
    !isRecoveryString(value.schemaVersion) ||
    !isRecoveryString(value.createdAt) ||
    !isRecoveryRecord(database) ||
    database.engine !== "postgres" ||
    database.dumpFormat !== "postgres-custom" ||
    !isRecoveryString(database.version) ||
    !isRecoveryString(database.sha256, RECOVERY_SHA256) ||
    !isRecoveryCompatibility(value.compatibility) ||
    !isRecoverySecretList(value.requiredExternalSecrets) ||
    !isRecoveryRecord(migrations) ||
    typeof migrations.count !== "number" ||
    !Number.isSafeInteger(migrations.count) ||
    migrations.count < 0 ||
    !(typeof migrations.latestHash === "string" || migrations.latestHash === null) ||
    !Array.isArray(migrations.applied) ||
    !migrations.applied.every(
      (entry) =>
        isRecoveryRecord(entry) &&
        isRecoveryString(entry.hash) &&
        Number.isSafeInteger(entry.createdAt)
    ) ||
    !isRecoveryRecord(recoveryKey) ||
    !isRecoveryString(recoveryKey.fingerprint, RECOVERY_SHA256) ||
    !(typeof recoveryKey.rotatedAt === "string" || recoveryKey.rotatedAt === null) ||
    !isRecoveryRecord(sanitization) ||
    !isRecoveryStringArray(sanitization.clearedFields) ||
    !isRecoveryRecord(objects) ||
    !isRecoveryString(objects.bundlePath) ||
    !isRecoveryString(objects.manifestPath) ||
    !isRecoveryString(objects.latestManifestPath)
  ) {
    throw new Error("Recovery bundle inner manifest is invalid.");
  }
  const applied = migrations.applied as Array<{ hash: string; createdAt: number }>;
  const expectedPrefix = `control-plane-recovery/v1/${value.bundleId}`;
  if (
    migrations.count !== applied.length ||
    migrations.latestHash !== (applied.at(-1)?.hash ?? null) ||
    !value.requiredExternalSecrets.includes("BETTER_AUTH_SECRET") ||
    !value.requiredExternalSecrets.includes("ENCRYPTION_KEY") ||
    !value.requiredExternalSecrets.includes("DAOFLOW_RECOVERY_ENCRYPTION_KEY") ||
    objects.bundlePath !== `${expectedPrefix}/bundle.dfr` ||
    objects.manifestPath !== `${expectedPrefix}/manifest.json` ||
    objects.latestManifestPath !== "control-plane-recovery/v1/latest.json"
  ) {
    throw new Error("Recovery bundle inner manifest is inconsistent.");
  }
  return value as unknown as ControlPlaneRecoveryManifest;
}

export interface RecoveryBundleInspection {
  bundle: {
    path: string;
    sidecarPath: string;
    sha256: string;
    keyFingerprint: string;
    formatVersion: typeof CONTROL_PLANE_RECOVERY_FORMAT_VERSION;
  };
  manifest: ControlPlaneRecoveryManifest;
  sidecar: ControlPlaneRecoverySidecar;
  workspace: string;
  dumpPath: string;
  cleanup(): Promise<void>;
}

export interface RecoveryRestoreCheck {
  id: string;
  status: "passed";
  detail: string;
}

export interface RecoveryRestoreStep {
  id: string;
  action: string;
  detail: string;
}

export interface ControlPlaneRecoveryRestorePlan {
  version: 1;
  bundle: {
    id: string;
    sha256: string;
    databaseSha256: string;
    appVersion: string;
    schemaVersion: string;
    createdAt: string;
    keyFingerprint: string;
  };
  installation: { directory: string; version: string };
  databases: { oldDatabase: string; newDatabase: string };
  preflight: {
    keyedFingerprintAlgorithm: "hmac-sha256";
    executionSecretFingerprints: Record<string, string>;
    installationEnvDigest: string;
    composeDigest: string;
    targetPostgresVersion: string;
    targetDatabaseDoesNotExist: true;
  };
  requiredExternalSecrets: string[];
  verification: { email: string };
  checks: RecoveryRestoreCheck[];
  steps: RecoveryRestoreStep[];
  planHash: string;
}

export interface ControlPlaneRecoveryRestoreInspection extends RecoveryBundleInspection {
  plan: ControlPlaneRecoveryRestorePlan;
  /** Internal execution-only values. Do not serialize or print this object. */
  secrets: Readonly<Record<string, string>>;
}

export interface RecoveryRestoreRuntime {
  execFile(
    command: string,
    args: readonly string[],
    options: { cwd?: string; env?: NodeJS.ProcessEnv }
  ): string;
  fetch(input: string | URL | Request, init?: RequestInit): Promise<Response>;
  sleep(ms: number): Promise<void>;
  now(): Date;
}

export type RecoveryDatabaseEvidence = {
  teams: number;
  users: number;
  userIdentities: number;
  teamMembers: number;
  projects: number;
  servers: number;
  auditEntries: number;
  backupPolicies: number;
  backupRuns: number;
  orphanTeamMembers: number;
  orphanProjects: number;
  orphanServers: number;
  fingerprints: {
    teams: string;
    users: string;
    userIdentities: string;
    teamMembers: string;
    projects: string;
    auditEntries: string;
    backupPolicies: string;
    backupRuns: string;
  };
  projectsById: Array<{ id: string; teamId: string }>;
  serversById: Array<{ id: string; teamId: string | null }>;
  backupPoliciesById: Array<{ id: string; teamId: string | null }>;
  backupRunsById: Array<{ id: string; policyId: string }>;
  verificationPrincipal: {
    id: string;
    email: string;
    role: string;
    activeTeamId: string;
  };
};

export type RecoveryMigrationEntry = { hash: string; createdAt: number };
