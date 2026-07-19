import { createCipheriv, createHash, createHmac } from "node:crypto";
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { inspectControlPlaneRecoveryRestoreBundle } from "./control-plane-recovery-restore-bundle";

const workspaces: string[] = [];
const KEY = "recovery-key-material-for-restore-inspection-tests";

afterEach(() => {
  for (const workspace of workspaces.splice(0)) rmSync(workspace, { recursive: true, force: true });
});

describe("control-plane recovery restore bundle inspection", () => {
  test("authenticates and extracts a valid version-one bundle", async () => {
    const fixture = writeFixture();
    const inspected = await inspectControlPlaneRecoveryRestoreBundle({
      ...fixture,
      recoveryKey: KEY,
      workspaceRoot: fixture.root
    });

    expect(inspected.manifest.bundleId).toBe("recovery_235");
    expect(readFileSync(inspected.dumpPath)).toEqual(fixture.dump);
    expect(inspected.sidecar.bundleSha256).toBe(inspected.bundle.sha256);
    expect(inspected.manifest.database.sha256).toBe(sha256(fixture.dump));

    await inspected.cleanup();
    expect(existsSync(inspected.workspace)).toBe(false);
  });

  test("rejects a wrong key without placing it in the error", async () => {
    const fixture = writeFixture();
    const wrongKey = "wrong-recovery-key-material";

    await expect(
      inspectControlPlaneRecoveryRestoreBundle({ ...fixture, recoveryKey: wrongKey })
    ).rejects.toThrow("authentication failed");
    await expect(
      inspectControlPlaneRecoveryRestoreBundle({ ...fixture, recoveryKey: wrongKey })
    ).rejects.not.toThrow(wrongKey);
  });

  test("rejects corrupted bytes before decryption", async () => {
    const fixture = writeFixture();
    const bytes = readFileSync(fixture.bundlePath);
    bytes[bytes.length - 1] ^= 0xff;
    writeFileSync(fixture.bundlePath, bytes);

    await expect(
      inspectControlPlaneRecoveryRestoreBundle({ ...fixture, recoveryKey: KEY })
    ).rejects.toThrow("SHA-256");
  });

  test("rejects an otherwise authenticated unsupported bundle version", async () => {
    const fixture = writeFixture({ headerVersion: 2 });

    await expect(
      inspectControlPlaneRecoveryRestoreBundle({ ...fixture, recoveryKey: KEY })
    ).rejects.toThrow("format version is unsupported");
  });

  test("rejects a signed sidecar that identifies a different encrypted manifest", async () => {
    const fixture = writeFixture({ sidecarBundleId: "recovery_other" });

    await expect(
      inspectControlPlaneRecoveryRestoreBundle({ ...fixture, recoveryKey: KEY })
    ).rejects.toThrow("does not match the encrypted manifest");
  });
});

function writeFixture(input: { headerVersion?: number; sidecarBundleId?: string } = {}) {
  const root = mkdtempSync(join(tmpdir(), "daoflow-recovery-restore-bundle-"));
  workspaces.push(root);
  const dump = Buffer.from("PGDMP\u0001custom-format-postgresql-dump");
  const manifest = {
    formatVersion: 1,
    bundleId: "recovery_235",
    appVersion: "0.9.2",
    schemaVersion: "migration-hash",
    createdAt: "2026-07-18T12:00:00.000Z",
    database: {
      engine: "postgres",
      version: "17.2",
      dumpFormat: "postgres-custom",
      sha256: sha256(dump)
    },
    migrations: {
      count: 1,
      latestHash: "migration-hash",
      applied: [{ hash: "migration-hash", createdAt: 1 }]
    },
    compatibility: { minimumAppVersion: "0.9.0", maximumAppVersionExclusive: "1.0.0" },
    requiredExternalSecrets: [
      "BETTER_AUTH_SECRET",
      "ENCRYPTION_KEY",
      "DAOFLOW_RECOVERY_ENCRYPTION_KEY"
    ],
    recoveryKey: { fingerprint: sha256(Buffer.from(KEY)), rotatedAt: null },
    sanitization: { clearedFields: ["sessions.*"] },
    objects: {
      bundlePath: "control-plane-recovery/v1/recovery_235/bundle.dfr",
      manifestPath: "control-plane-recovery/v1/recovery_235/manifest.json",
      latestManifestPath: "control-plane-recovery/v1/latest.json"
    }
  };
  const manifestBytes = Buffer.from(JSON.stringify(manifest));
  const prefix = Buffer.alloc(4);
  prefix.writeUInt32BE(manifestBytes.length);
  const length = Buffer.alloc(8);
  length.writeBigUInt64BE(BigInt(dump.length));
  const header = Buffer.concat([
    Buffer.from("DFCPR"),
    Buffer.from([input.headerVersion ?? 1]),
    Buffer.alloc(12, 7)
  ]);
  const cipher = createCipheriv(
    "aes-256-gcm",
    createHash("sha256").update(KEY).digest(),
    header.subarray(6)
  );
  cipher.setAAD(header);
  const encrypted = Buffer.concat([
    cipher.update(Buffer.concat([prefix, manifestBytes, length, dump])),
    cipher.final()
  ]);
  const bundle = Buffer.concat([header, encrypted, cipher.getAuthTag()]);
  const bundlePath = join(root, "bundle.dfr");
  writeFileSync(bundlePath, bundle, { mode: 0o600 });
  const unsigned = {
    formatVersion: 1,
    bundleId: input.sidecarBundleId ?? manifest.bundleId,
    appVersion: manifest.appVersion,
    schemaVersion: manifest.schemaVersion,
    createdAt: manifest.createdAt,
    bundlePath: manifest.objects.bundlePath,
    bundleSha256: sha256(bundle),
    keyFingerprint: manifest.recoveryKey.fingerprint,
    compatibility: manifest.compatibility,
    requiredExternalSecrets: manifest.requiredExternalSecrets
  };
  const hmac = createHmac("sha256", createHash("sha256").update(KEY).digest())
    .update(JSON.stringify(unsigned))
    .digest("hex");
  const sidecarPath = join(root, "manifest.json");
  writeFileSync(sidecarPath, JSON.stringify({ ...unsigned, hmac }), { mode: 0o600 });
  return { root, bundlePath, sidecarPath, dump };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}
