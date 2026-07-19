import { eq } from "drizzle-orm";
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

import { db } from "../../../db/connection";
import { backupDestinations } from "../../../db/schema/destinations";
import {
  controlPlaneRecoveryBundles,
  type ControlPlaneRecoveryManifest,
  type ControlPlaneRecoveryVerificationResult
} from "../../../db/schema/control-plane-recovery";
import {
  resolveControlPlaneRecoveryKeyMetadata,
  resolveControlPlaneRecoveryKeySet
} from "../../../db/services/control-plane-recovery-key";
import { toDestinationConfig } from "../../../db/services/destination-shared";
import { copyObjectFromRemoteAsync, copyObjectToRemoteAsync } from "../../rclone-executor";
import {
  createEncryptedControlPlaneRecoveryBundle,
  extractEncryptedControlPlaneRecoveryBundle,
  verifyControlPlaneRecoverySidecar
} from "./control-plane-recovery-bundle";
import { prepareSanitizedControlPlaneRecoveryDump } from "./control-plane-recovery-database";
import {
  runWithRecoveryActivityHeartbeat,
  throwIfRecoveryCancelled
} from "./control-plane-recovery-heartbeat";
import {
  cleanupControlPlaneRecoveryWorkspace,
  controlPlaneRecoveryObjectPaths,
  createControlPlaneRecoveryWorkspace,
  nextMajorVersion,
  safeControlPlaneRecoveryError,
  sha256File
} from "./control-plane-recovery-safety";
import type { ControlPlaneRecoveryExecutionResult } from "./control-plane-recovery-types";

const SERVER_VERSION = "0.10.0";

export {
  markControlPlaneRecoveryFailed,
  markControlPlaneRecoveryRunning,
  markControlPlaneRecoveryVerified
} from "./control-plane-recovery-recording";

/** Safe activity result for preflight views and Temporal history. */
// eslint-disable-next-line @typescript-eslint/require-await
export async function resolveControlPlaneRecoveryKey(): Promise<{
  fingerprint: string;
  rotatedAt: string | null;
}> {
  return resolveControlPlaneRecoveryKeyMetadata();
}

export async function executeControlPlaneRecoveryBundle(
  bundleId: string
): Promise<ControlPlaneRecoveryExecutionResult> {
  return runWithRecoveryActivityHeartbeat((signal) =>
    executeControlPlaneRecoveryBundleWithSignal(bundleId, signal)
  );
}

async function executeControlPlaneRecoveryBundleWithSignal(
  bundleId: string,
  signal?: AbortSignal
): Promise<ControlPlaneRecoveryExecutionResult> {
  const startedAt = Date.now();
  const workspace = createControlPlaneRecoveryWorkspace(bundleId);
  try {
    throwIfRecoveryCancelled(signal);
    const run = await resolveRecoveryRun(bundleId);
    throwIfRecoveryCancelled(signal);
    const keySet = resolveControlPlaneRecoveryKeySet();
    const prepared = await prepareSanitizedControlPlaneRecoveryDump({
      bundleId,
      workspace,
      cancellationSignal: signal
    });
    throwIfRecoveryCancelled(signal);
    const objectPaths = controlPlaneRecoveryObjectPaths(bundleId);
    const manifest = createManifest({
      bundleId,
      objectPaths,
      keyFingerprint: keySet.fingerprint,
      keyRotatedAt: keySet.rotatedAt,
      prepared
    });
    const created = await createEncryptedControlPlaneRecoveryBundle({
      workspace,
      dumpPath: prepared.dumpPath,
      manifest,
      keyMaterial: keySet.currentKeyMaterial
    });
    throwIfRecoveryCancelled(signal);
    await uploadRecoveryObjects(run.destination, manifest.objects, created, signal);
    await verifyRemoteRoundTrip({
      workspace,
      destination: run.destination,
      manifest,
      expectedBundleChecksum: created.bundleSha256,
      keySet,
      signal
    });
    throwIfRecoveryCancelled(signal);
    await uploadLatestManifest(
      run.destination,
      manifest.objects.latestManifestPath,
      created.latestSidecarPath,
      signal
    );
    throwIfRecoveryCancelled(signal);

    const completedAt = new Date().toISOString();
    const verificationResult: ControlPlaneRecoveryVerificationResult = {
      ...prepared.verification,
      databaseSha256: prepared.databaseSha256,
      bundleSha256: created.bundleSha256,
      durationMs: Math.max(0, Date.now() - startedAt),
      completedAt,
      checks: {
        ...prepared.verification.checks,
        remoteRoundTrip: {
          status: "passed",
          detail:
            "Uploaded bundle was downloaded, authenticated, decrypted, and extracted successfully."
        }
      }
    };
    return {
      bundleId,
      keyFingerprint: keySet.fingerprint,
      keyRotatedAt: keySet.rotatedAt,
      objectPaths,
      manifest,
      verificationResult,
      bundleChecksum: created.bundleSha256,
      databaseChecksum: prepared.databaseSha256,
      sizeBytes: created.sizeBytes
    };
  } catch (error) {
    throw new Error(safeControlPlaneRecoveryError(error));
  } finally {
    cleanupControlPlaneRecoveryWorkspace(workspace);
  }
}

async function resolveRecoveryRun(
  bundleId: string
): Promise<{ destination: ReturnType<typeof toDestinationConfig> }> {
  const [bundle] = await db
    .select()
    .from(controlPlaneRecoveryBundles)
    .where(eq(controlPlaneRecoveryBundles.id, bundleId))
    .limit(1);
  if (!bundle) throw new Error("Control-plane recovery bundle no longer exists.");
  const [destination] = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, bundle.destinationId))
    .limit(1);
  if (!destination || destination.teamId !== bundle.ownerTeamId) {
    throw new Error(
      "Control-plane recovery destination is no longer available to the owning team."
    );
  }
  return { destination: toDestinationConfig(destination) };
}

function createManifest(input: {
  bundleId: string;
  objectPaths: ReturnType<typeof controlPlaneRecoveryObjectPaths>;
  keyFingerprint: string;
  keyRotatedAt: string | null;
  prepared: Awaited<ReturnType<typeof prepareSanitizedControlPlaneRecoveryDump>>;
}): ControlPlaneRecoveryManifest {
  return {
    formatVersion: 1,
    bundleId: input.bundleId,
    appVersion: process.env.DAOFLOW_APP_VERSION?.trim() || SERVER_VERSION,
    schemaVersion: input.prepared.migrations.latestHash ?? "unmigrated",
    createdAt: new Date().toISOString(),
    database: {
      engine: "postgres",
      version: input.prepared.sourcePostgresVersion,
      dumpFormat: "postgres-custom",
      sha256: input.prepared.databaseSha256
    },
    migrations: input.prepared.migrations,
    compatibility: {
      minimumAppVersion: process.env.DAOFLOW_APP_VERSION?.trim() || SERVER_VERSION,
      maximumAppVersionExclusive: nextMajorVersion(
        process.env.DAOFLOW_APP_VERSION?.trim() || SERVER_VERSION
      )
    },
    requiredExternalSecrets: requiredExternalSecrets(),
    recoveryKey: { fingerprint: input.keyFingerprint, rotatedAt: input.keyRotatedAt },
    sanitization: input.prepared.sanitization,
    objects: input.objectPaths
  };
}

async function uploadRecoveryObjects(
  destination: ReturnType<typeof toDestinationConfig>,
  objectPaths: ControlPlaneRecoveryManifest["objects"],
  created: { bundlePath: string; sidecarPath: string },
  signal?: AbortSignal
): Promise<void> {
  assertRcloneSuccess(
    await copyObjectToRemoteAsync(destination, created.bundlePath, objectPaths.bundlePath, {
      cancellationSignal: signal
    }),
    signal
  );
  assertRcloneSuccess(
    await copyObjectToRemoteAsync(destination, created.sidecarPath, objectPaths.manifestPath, {
      cancellationSignal: signal
    }),
    signal
  );
}

async function uploadLatestManifest(
  destination: ReturnType<typeof toDestinationConfig>,
  latestManifestPath: string,
  localLatestManifestPath: string,
  signal?: AbortSignal
): Promise<void> {
  assertRcloneSuccess(
    await copyObjectToRemoteAsync(destination, localLatestManifestPath, latestManifestPath, {
      cancellationSignal: signal
    }),
    signal
  );
}

async function verifyRemoteRoundTrip(input: {
  workspace: string;
  destination: ReturnType<typeof toDestinationConfig>;
  manifest: ControlPlaneRecoveryManifest;
  expectedBundleChecksum: string;
  keySet: ReturnType<typeof resolveControlPlaneRecoveryKeySet>;
  signal?: AbortSignal;
}): Promise<void> {
  const downloadDirectory = join(input.workspace, "remote-round-trip");
  mkdirSync(downloadDirectory, { recursive: true, mode: 0o700 });
  const remoteBundlePath = join(downloadDirectory, "bundle.dfr");
  const remoteManifestPath = join(downloadDirectory, "manifest.json");
  const [bundleDownload, manifestDownload] = await Promise.all([
    copyObjectFromRemoteAsync(
      input.destination,
      input.manifest.objects.bundlePath,
      remoteBundlePath,
      { cancellationSignal: input.signal }
    ),
    copyObjectFromRemoteAsync(
      input.destination,
      input.manifest.objects.manifestPath,
      remoteManifestPath,
      { cancellationSignal: input.signal }
    )
  ]);
  assertRcloneSuccess(bundleDownload, input.signal);
  assertRcloneSuccess(manifestDownload, input.signal);
  throwIfRecoveryCancelled(input.signal);
  if ((await sha256File(remoteBundlePath)) !== input.expectedBundleChecksum) {
    throw new Error("Downloaded recovery bundle checksum does not match the uploaded object.");
  }
  const sidecar = verifyControlPlaneRecoverySidecar(
    readFileSync(remoteManifestPath, "utf8"),
    input.keySet
  );
  if (
    sidecar.bundleId !== input.manifest.bundleId ||
    sidecar.bundlePath !== input.manifest.objects.bundlePath ||
    sidecar.bundleSha256 !== input.expectedBundleChecksum
  ) {
    throw new Error("Downloaded recovery sidecar does not match the uploaded bundle.");
  }
  const extracted = await extractEncryptedControlPlaneRecoveryBundle({
    workspace: downloadDirectory,
    bundlePath: remoteBundlePath,
    keySet: input.keySet
  });
  throwIfRecoveryCancelled(input.signal);
  if (
    extracted.manifest.bundleId !== input.manifest.bundleId ||
    extracted.manifest.database.sha256 !== input.manifest.database.sha256 ||
    (await sha256File(extracted.dumpPath)) !== input.manifest.database.sha256
  ) {
    throw new Error("Downloaded recovery bundle contents did not pass round-trip verification.");
  }
}

function requiredExternalSecrets(): string[] {
  const names = ["BETTER_AUTH_SECRET", "ENCRYPTION_KEY", "DAOFLOW_RECOVERY_ENCRYPTION_KEY"];
  if (process.env.DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY?.trim()) {
    names.push("DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY");
  }
  return names;
}

function assertRcloneSuccess(result: { success: boolean }, signal?: AbortSignal): void {
  throwIfRecoveryCancelled(signal);
  if (!result.success) throw new Error("Recovery object transfer failed.");
}
