import { describe, expect, it } from "vitest";
import {
  toSafeControlPlaneRecoveryManifest,
  toSafeControlPlaneRecoveryVerification
} from "./control-plane-recovery-views";

describe("control-plane recovery public views", () => {
  it("keeps recovery metadata useful without revealing key material", () => {
    const manifest = toSafeControlPlaneRecoveryManifest({
      formatVersion: 1,
      bundleId: "rb_safe_1",
      appVersion: "0.9.2",
      schemaVersion: "0034_pale_red_ghost",
      createdAt: "2026-07-18T00:00:00.000Z",
      database: {
        engine: "postgres",
        version: "17.4",
        dumpFormat: "postgres-custom",
        sha256: "a".repeat(64)
      },
      migrations: { count: 34, latestHash: "migration-hash", applied: [] },
      compatibility: { minimumAppVersion: "0.9.2", maximumAppVersionExclusive: "1.0.0" },
      requiredExternalSecrets: ["DAOFLOW_RECOVERY_ENCRYPTION_KEY"],
      recoveryKey: { fingerprint: "sha256:recovery-key-fingerprint", rotatedAt: null },
      sanitization: { clearedFields: ["ssh_private_key"] },
      objects: {
        bundlePath: "control-plane-recovery/rb_safe_1.bundle",
        manifestPath: "control-plane-recovery/rb_safe_1.manifest.json",
        latestManifestPath: "control-plane-recovery/latest.manifest.json"
      }
    });

    expect(manifest).toMatchObject({
      bundleId: "rb_safe_1",
      recoveryKey: { fingerprint: "sha256:recovery-key-fingerprint" },
      requiredExternalSecrets: ["DAOFLOW_RECOVERY_ENCRYPTION_KEY"]
    });
    expect(JSON.stringify(manifest)).not.toContain("recovery-key-material");
  });

  it("redacts sensitive verification failures before returning them", () => {
    const verification = toSafeControlPlaneRecoveryVerification({
      version: 1,
      success: false,
      databaseSha256: "a".repeat(64),
      bundleSha256: "b".repeat(64),
      sourcePostgresVersion: "17.4",
      verifierImage: `postgres:17@sha256:${"c".repeat(64)}`,
      durationMs: 10,
      checks: {
        archive: { status: "passed", detail: "Archive checksum matched." },
        restore: { status: "failed", detail: "postgresql://dao:password@db/recovery failed" },
        migrations: { status: "skipped", detail: "Not reached." },
        ownership: { status: "skipped", detail: "Not reached." },
        secretDecryptability: { status: "skipped", detail: "Not reached." },
        remoteRoundTrip: { status: "skipped", detail: "Not reached." }
      },
      objectCounts: {
        teams: 1,
        users: 1,
        projects: 1,
        servers: 1,
        auditEntries: 1,
        backupRuns: 1
      },
      completedAt: "2026-07-18T00:00:10.000Z",
      error: "secret=do-not-return"
    });

    const serialized = JSON.stringify(verification);
    expect(serialized).not.toContain("password@db");
    expect(serialized).not.toContain("do-not-return");
    expect(verification?.checks.restore.detail).toBe("Sensitive execution detail redacted.");
  });
});
