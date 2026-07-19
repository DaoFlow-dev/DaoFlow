import type {
  ControlPlaneRecoveryCheck,
  ControlPlaneRecoveryManifest,
  ControlPlaneRecoveryVerificationResult,
  controlPlaneRecoveryBundles
} from "../schema/control-plane-recovery";
import type { backupDestinations } from "../schema/destinations";

type RecoveryBundleRow = typeof controlPlaneRecoveryBundles.$inferSelect;
type DestinationRow = typeof backupDestinations.$inferSelect;

const SENSITIVE_DETAIL_PATTERN =
  /(?:postgres(?:ql)?|mysql|mongodb(?:\+srv)?|https?|s3):\/\/\S+|\b(?:password|secret|token|credential|private\s*key|(?:recovery|encryption|api)?[_\s-]*key(?:\s*material)?)\b\s*[:=]\s*\S+/i;

function safeEndpoint(endpoint: string | null): string | null {
  if (!endpoint) return null;

  try {
    return new URL(endpoint).origin;
  } catch {
    return "Configured endpoint";
  }
}

function safeDetail(detail: string): string {
  const normalized = detail.trim().slice(0, 500);
  return SENSITIVE_DETAIL_PATTERN.test(normalized)
    ? "Sensitive execution detail redacted."
    : normalized;
}

function safeFailureMessage(error: string | null): string | null {
  if (!error) return null;

  const normalized = error.trim().slice(0, 500);
  return SENSITIVE_DETAIL_PATTERN.test(normalized)
    ? "Recovery bundle execution failed. Review the audit trail for the bundle ID."
    : normalized;
}

function toSafeCheck(check: ControlPlaneRecoveryCheck) {
  return {
    status: check.status,
    detail: safeDetail(check.detail)
  };
}

function verificationPassed(verification: ControlPlaneRecoveryVerificationResult | null): boolean {
  return Boolean(
    verification?.success &&
    verification.bundleSha256.length === 64 &&
    verification.databaseSha256.length === 64 &&
    Object.values(verification.checks).every((check) => check.status === "passed")
  );
}

export function toControlPlaneRecoveryDestinationSummary(destination: DestinationRow | null) {
  if (!destination) return null;

  return {
    id: destination.id,
    name: destination.name,
    provider: destination.provider,
    bucket: destination.bucket,
    region: destination.region,
    endpoint: safeEndpoint(destination.endpoint)
  };
}

export function toSafeControlPlaneRecoveryManifest(manifest: ControlPlaneRecoveryManifest | null) {
  if (!manifest) return null;

  return {
    formatVersion: manifest.formatVersion,
    bundleId: manifest.bundleId,
    appVersion: manifest.appVersion,
    schemaVersion: manifest.schemaVersion,
    createdAt: manifest.createdAt,
    database: {
      engine: manifest.database.engine,
      version: manifest.database.version,
      dumpFormat: manifest.database.dumpFormat,
      sha256: manifest.database.sha256
    },
    migrations: {
      count: manifest.migrations.count,
      latestHash: manifest.migrations.latestHash,
      applied: manifest.migrations.applied.map((entry) => ({
        hash: entry.hash,
        createdAt: entry.createdAt
      }))
    },
    compatibility: {
      minimumAppVersion: manifest.compatibility.minimumAppVersion,
      maximumAppVersionExclusive: manifest.compatibility.maximumAppVersionExclusive
    },
    requiredExternalSecrets: [...manifest.requiredExternalSecrets],
    recoveryKey: {
      fingerprint: manifest.recoveryKey.fingerprint,
      rotatedAt: manifest.recoveryKey.rotatedAt
    },
    sanitization: {
      clearedFields: [...manifest.sanitization.clearedFields]
    },
    objects: {
      bundlePath: manifest.objects.bundlePath,
      manifestPath: manifest.objects.manifestPath,
      latestManifestPath: manifest.objects.latestManifestPath
    }
  };
}

export function toSafeControlPlaneRecoveryVerification(
  verification: ControlPlaneRecoveryVerificationResult | null
) {
  if (!verification) return null;

  return {
    success: verification.success,
    completedAt: verification.completedAt,
    error: safeFailureMessage(verification.error ?? null),
    checks: {
      archive: toSafeCheck(verification.checks.archive),
      restore: toSafeCheck(verification.checks.restore),
      migrations: toSafeCheck(verification.checks.migrations),
      ownership: toSafeCheck(verification.checks.ownership),
      secretDecryptability: toSafeCheck(verification.checks.secretDecryptability),
      remoteRoundTrip: toSafeCheck(verification.checks.remoteRoundTrip)
    }
  };
}

export function toControlPlaneRecoveryBundleView(input: {
  bundle: RecoveryBundleRow;
  destination: DestinationRow | null;
}) {
  const destination = toControlPlaneRecoveryDestinationSummary(input.destination);
  const manifest = toSafeControlPlaneRecoveryManifest(input.bundle.manifest);
  const verification = toSafeControlPlaneRecoveryVerification(input.bundle.verificationResult);
  const failedVerification =
    input.bundle.status === "verified" && !verificationPassed(input.bundle.verificationResult);
  const objectPaths = {
    bundlePath: input.bundle.bundleObjectPath,
    manifestPath: input.bundle.manifestObjectPath,
    latestManifestPath: input.bundle.latestManifestObjectPath
  };

  return {
    id: input.bundle.id,
    status: failedVerification ? "failed" : input.bundle.status,
    appVersion: input.bundle.appVersion,
    schemaVersion: input.bundle.schemaVersion,
    keyFingerprint: input.bundle.keyFingerprint,
    keyRotatedAt: input.bundle.keyRotatedAt?.toISOString() ?? null,
    destinationId: input.bundle.destinationId,
    destination,
    destinationSummary: destination,
    objectPrefix: input.bundle.objectPrefix,
    bundleObjectPath: input.bundle.bundleObjectPath,
    manifestObjectPath: input.bundle.manifestObjectPath,
    latestManifestObjectPath: input.bundle.latestManifestObjectPath,
    objectPaths,
    bundleChecksum: input.bundle.bundleChecksum,
    databaseChecksum: input.bundle.databaseChecksum,
    checksums: {
      bundle: input.bundle.bundleChecksum,
      database: input.bundle.databaseChecksum
    },
    sizeBytes: input.bundle.sizeBytes,
    manifest,
    verification,
    verificationResult: verification,
    error: failedVerification
      ? "Recovery verification did not pass every required check."
      : safeFailureMessage(input.bundle.error),
    createdAt: input.bundle.createdAt.toISOString(),
    updatedAt: input.bundle.updatedAt.toISOString(),
    startedAt: input.bundle.startedAt?.toISOString() ?? null,
    completedAt: input.bundle.completedAt?.toISOString() ?? null
  };
}

export function toControlPlaneRecoveryMetadataView(input: {
  bundle: RecoveryBundleRow;
  destination: DestinationRow | null;
}) {
  const bundle = toControlPlaneRecoveryBundleView(input);

  return {
    bundleId: bundle.id,
    destinationId: bundle.destinationId,
    destination: bundle.destination,
    appVersion: bundle.appVersion,
    schemaVersion: bundle.schemaVersion,
    keyFingerprint: bundle.keyFingerprint,
    keyRotatedAt: bundle.keyRotatedAt,
    objectPaths: bundle.objectPaths,
    checksums: bundle.checksums,
    manifest: bundle.manifest,
    requiredExternalSecrets: bundle.manifest?.requiredExternalSecrets ?? [],
    verification: bundle.verification
  };
}
