import { createHash } from "node:crypto";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";

import type { ControlPlaneRecoveryManifest } from "../../../db/schema/control-plane-recovery";
import {
  createEncryptedControlPlaneRecoveryBundle,
  extractEncryptedControlPlaneRecoveryBundle,
  verifyControlPlaneRecoverySidecar
} from "./control-plane-recovery-bundle";
import { sha256File } from "./control-plane-recovery-safety";

const workspaces: string[] = [];

afterEach(() => {
  for (const workspace of workspaces.splice(0)) {
    rmSync(workspace, { recursive: true, force: true });
  }
});

describe("control-plane recovery bundle", () => {
  it("streams an authenticated encrypted bundle and decrypts it with the previous key", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "daoflow-recovery-bundle-test-"));
    workspaces.push(workspace);
    const dumpPath = join(workspace, "sanitized.dump");
    writeFileSync(dumpPath, Buffer.from("custom-postgres-dump-content".repeat(256)), {
      mode: 0o600
    });
    const oldKey = "previous-recovery-key-material-that-is-long-enough";
    const oldKeyFingerprint = createHash("sha256").update(oldKey).digest("hex");
    const manifest = makeManifest(await sha256File(dumpPath));
    manifest.recoveryKey.fingerprint = oldKeyFingerprint;
    const created = await createEncryptedControlPlaneRecoveryBundle({
      workspace,
      dumpPath,
      manifest,
      keyMaterial: oldKey
    });

    expect(readFileSync(created.bundlePath, "utf8")).not.toContain(manifest.bundleId);
    const sidecar = verifyControlPlaneRecoverySidecar(readFileSync(created.sidecarPath, "utf8"), {
      currentKeyMaterial: "current-recovery-key-material-that-is-long-enough",
      previousKeyMaterial: oldKey,
      fingerprint: oldKeyFingerprint,
      rotatedAt: null
    });
    expect(sidecar.bundleSha256).toBe(created.bundleSha256);
    expect(sidecar).toMatchObject({
      appVersion: manifest.appVersion,
      schemaVersion: manifest.schemaVersion,
      compatibility: manifest.compatibility,
      requiredExternalSecrets: manifest.requiredExternalSecrets
    });

    const extracted = await extractEncryptedControlPlaneRecoveryBundle({
      workspace: join(workspace, "extract"),
      bundlePath: created.bundlePath,
      keySet: {
        currentKeyMaterial: "current-recovery-key-material-that-is-long-enough",
        previousKeyMaterial: oldKey,
        fingerprint: oldKeyFingerprint,
        rotatedAt: null
      }
    });
    expect(extracted.manifest).toEqual(manifest);
    await expect(sha256File(extracted.dumpPath)).resolves.toBe(manifest.database.sha256);
  });

  it("rejects a sidecar whose HMAC does not match a configured recovery key", async () => {
    const workspace = mkdtempSync(join(tmpdir(), "daoflow-recovery-bundle-test-"));
    workspaces.push(workspace);
    const dumpPath = join(workspace, "sanitized.dump");
    writeFileSync(dumpPath, "dump", { mode: 0o600 });
    const created = await createEncryptedControlPlaneRecoveryBundle({
      workspace,
      dumpPath,
      manifest: makeManifest(await sha256File(dumpPath)),
      keyMaterial: "recovery-key-material-that-is-long-enough"
    });

    expect(() =>
      verifyControlPlaneRecoverySidecar(readFileSync(created.sidecarPath, "utf8"), {
        currentKeyMaterial: "different-recovery-key-material-that-is-long-enough",
        previousKeyMaterial: null,
        fingerprint: "b".repeat(64),
        rotatedAt: null
      })
    ).toThrow("authentication failed");
  });
});

function makeManifest(databaseSha256: string): ControlPlaneRecoveryManifest {
  return {
    formatVersion: 1,
    bundleId: "recovery_217",
    appVersion: "0.9.2",
    schemaVersion: "migration-hash",
    createdAt: "2026-07-18T12:00:00.000Z",
    database: {
      engine: "postgres",
      version: "17.2",
      dumpFormat: "postgres-custom",
      sha256: databaseSha256
    },
    migrations: {
      count: 1,
      latestHash: "migration-hash",
      applied: [{ hash: "migration-hash", createdAt: 1 }]
    },
    compatibility: { minimumAppVersion: "0.9.2", maximumAppVersionExclusive: "1.0.0" },
    requiredExternalSecrets: ["ENCRYPTION_KEY", "DAOFLOW_RECOVERY_ENCRYPTION_KEY"],
    recoveryKey: { fingerprint: "a".repeat(64), rotatedAt: null },
    sanitization: { clearedFields: ["sessions.*"] },
    objects: {
      bundlePath: "control-plane-recovery/v1/recovery_217/bundle.dfr",
      manifestPath: "control-plane-recovery/v1/recovery_217/manifest.json",
      latestManifestPath: "control-plane-recovery/v1/latest.json"
    }
  };
}
