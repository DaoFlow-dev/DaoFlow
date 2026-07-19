import type {
  ControlPlaneRecoveryManifest,
  ControlPlaneRecoveryVerificationResult
} from "../../../db/schema/control-plane-recovery";

export const CONTROL_PLANE_RECOVERY_FORMAT_VERSION = 1 as const;

export interface ControlPlaneRecoveryObjectPaths {
  prefix: string;
  bundlePath: string;
  manifestPath: string;
  latestManifestPath: string;
}

export interface ControlPlaneRecoverySidecarManifest {
  formatVersion: typeof CONTROL_PLANE_RECOVERY_FORMAT_VERSION;
  bundleId: string;
  appVersion: string;
  schemaVersion: string;
  createdAt: string;
  bundlePath: string;
  bundleSha256: string;
  keyFingerprint: string;
  compatibility: ControlPlaneRecoveryManifest["compatibility"];
  requiredExternalSecrets: string[];
  hmac: string;
}

export interface PreparedControlPlaneRecoveryDump {
  dumpPath: string;
  databaseSha256: string;
  databaseSizeBytes: number;
  sourcePostgresVersion: string;
  verifierImage: string;
  migrations: ControlPlaneRecoveryManifest["migrations"];
  objectCounts: ControlPlaneRecoveryVerificationResult["objectCounts"];
  sanitization: ControlPlaneRecoveryManifest["sanitization"];
  verification: Omit<
    ControlPlaneRecoveryVerificationResult,
    "bundleSha256" | "databaseSha256" | "durationMs" | "completedAt"
  >;
}

export interface CreatedControlPlaneRecoveryBundle {
  bundlePath: string;
  sidecarPath: string;
  latestSidecarPath: string;
  bundleSha256: string;
  sizeBytes: number;
}

export interface ControlPlaneRecoveryExecutionResult {
  bundleId: string;
  keyFingerprint: string;
  keyRotatedAt: string | null;
  objectPaths: ControlPlaneRecoveryObjectPaths;
  manifest: ControlPlaneRecoveryManifest;
  verificationResult: ControlPlaneRecoveryVerificationResult;
  bundleChecksum: string;
  databaseChecksum: string;
  sizeBytes: number;
}
