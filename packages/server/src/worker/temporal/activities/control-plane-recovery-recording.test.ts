import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";

import { db } from "../../../db/connection";
import { controlPlaneRecoveryBundles } from "../../../db/schema/control-plane-recovery";
import { backupDestinations } from "../../../db/schema/destinations";
import { resetTestDatabaseWithControlPlane } from "../../../test-db";
import type { ControlPlaneRecoveryExecutionResult } from "./control-plane-recovery-types";
import {
  markControlPlaneRecoveryFailed,
  markControlPlaneRecoveryRunning,
  markControlPlaneRecoveryVerified
} from "./control-plane-recovery-recording";

const destinationId = "dest_recovery_recording";

async function createBundle(id: string, status: "queued" | "running" | "verified" | "failed") {
  const prefix = `control-plane-recovery/v1/${id}`;
  await db.insert(controlPlaneRecoveryBundles).values({
    id,
    ownerTeamId: "team_foundation",
    destinationId,
    status,
    appVersion: "0.0.0-test",
    schemaVersion: "0035",
    keyFingerprint: "a".repeat(64),
    objectPrefix: prefix,
    bundleObjectPath: `${prefix}/bundle.dfr`,
    manifestObjectPath: `${prefix}/manifest.json`,
    latestManifestObjectPath: "control-plane-recovery/v1/latest.json",
    ...(status === "verified" || status === "failed" ? { completedAt: new Date() } : {})
  });
}

function executionResult(bundleId: string): ControlPlaneRecoveryExecutionResult {
  const prefix = `control-plane-recovery/v1/${bundleId}`;
  const completedAt = "2026-07-18T00:00:00.000Z";
  const checks = {
    archive: { status: "passed" as const, detail: "Archive was readable." },
    restore: { status: "passed" as const, detail: "Restore completed." },
    migrations: { status: "passed" as const, detail: "Migrations matched." },
    ownership: { status: "passed" as const, detail: "Ownership matched." },
    secretDecryptability: { status: "passed" as const, detail: "Secrets decrypted." },
    remoteRoundTrip: { status: "passed" as const, detail: "Round trip completed." }
  };

  return {
    bundleId,
    keyFingerprint: "b".repeat(64),
    keyRotatedAt: null,
    objectPaths: {
      prefix,
      bundlePath: `${prefix}/bundle.dfr`,
      manifestPath: `${prefix}/manifest.json`,
      latestManifestPath: "control-plane-recovery/v1/latest.json"
    },
    manifest: {
      formatVersion: 1,
      bundleId,
      appVersion: "0.0.0-test",
      schemaVersion: "0035",
      createdAt: completedAt,
      database: {
        engine: "postgres",
        version: "17.4",
        dumpFormat: "postgres-custom",
        sha256: "c".repeat(64)
      },
      migrations: { count: 35, latestHash: "0035", applied: [] },
      compatibility: { minimumAppVersion: "0.0.0-test", maximumAppVersionExclusive: "1.0.0" },
      requiredExternalSecrets: [],
      recoveryKey: { fingerprint: "b".repeat(64), rotatedAt: null },
      sanitization: { clearedFields: [] },
      objects: {
        bundlePath: `${prefix}/bundle.dfr`,
        manifestPath: `${prefix}/manifest.json`,
        latestManifestPath: "control-plane-recovery/v1/latest.json"
      }
    },
    verificationResult: {
      version: 1,
      success: true,
      databaseSha256: "c".repeat(64),
      bundleSha256: "d".repeat(64),
      sourcePostgresVersion: "17.4",
      verifierImage: `pgvector/pgvector:pg17@sha256:${"e".repeat(64)}`,
      durationMs: 1,
      checks,
      objectCounts: { teams: 1, users: 1, projects: 1, servers: 1, auditEntries: 1, backupRuns: 1 },
      completedAt
    },
    bundleChecksum: "d".repeat(64),
    databaseChecksum: "c".repeat(64),
    sizeBytes: 1
  };
}

async function statusFor(id: string) {
  const [bundle] = await db
    .select({ status: controlPlaneRecoveryBundles.status })
    .from(controlPlaneRecoveryBundles)
    .where(eq(controlPlaneRecoveryBundles.id, id));
  return bundle?.status;
}

describe("control-plane recovery status recording", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    await db.insert(backupDestinations).values({
      id: destinationId,
      teamId: "team_foundation",
      name: "Recovery recording fixture",
      provider: "local",
      localPath: "/tmp/daoflow-recovery-recording"
    });
  });

  it("allows only queued to running to verified and ignores a late failure", async () => {
    const bundleId = "recovery_record_verified";
    await createBundle(bundleId, "queued");

    await markControlPlaneRecoveryRunning(bundleId);
    await markControlPlaneRecoveryVerified(executionResult(bundleId));
    await markControlPlaneRecoveryFailed(bundleId, new Error("late failure"));

    expect(await statusFor(bundleId)).toBe("verified");
    await expect(markControlPlaneRecoveryRunning(bundleId)).rejects.toThrow(
      "cannot start from verified"
    );
  });

  it("does not allow a late success or restart to overwrite a failed bundle", async () => {
    const bundleId = "recovery_record_failed";
    await createBundle(bundleId, "queued");

    await markControlPlaneRecoveryRunning(bundleId);
    await markControlPlaneRecoveryFailed(bundleId, new Error("expected failure"));

    await expect(markControlPlaneRecoveryVerified(executionResult(bundleId))).rejects.toThrow(
      "cannot verify from failed"
    );
    await expect(markControlPlaneRecoveryRunning(bundleId)).rejects.toThrow(
      "cannot start from failed"
    );
    expect(await statusFor(bundleId)).toBe("failed");
  });
});
