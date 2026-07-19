import { createCipheriv, createHash, createHmac } from "node:crypto";
import { chmodSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, test } from "bun:test";

import { inspectControlPlaneRecoveryRestore } from "./control-plane-recovery-restore-plan";
import { controlPlaneRecoveryRestorePlanDependencies } from "./control-plane-recovery-restore-preflight";
import { compareSemanticVersions } from "./control-plane-recovery-restore-semver";

const roots: string[] = [];
const KEY = "recovery-key-material-for-restore-plan-tests";

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

describe("control-plane recovery restore planning", () => {
  test("creates a deterministic, secret-free plan after all local safety checks", async () => {
    const fixture = writeFixture();
    writeInstallation(fixture.root);
    const input = {
      ...fixture,
      secretsPath: join(fixture.root, "recovery-secrets.env"),
      installDir: fixture.root
    };
    writeSecrets(input.secretsPath);

    const first = await inspectWithPreflight(input);
    const second = await inspectWithPreflight(input);
    expect(first.plan).toMatchObject({
      bundle: { id: "recovery_235", appVersion: "0.9.2" },
      installation: { directory: fixture.root, version: "0.9.2" },
      databases: { oldDatabase: "legacy_daoflow", newDatabase: "daoflow_recovery_recovery_235" },
      preflight: {
        keyedFingerprintAlgorithm: "hmac-sha256",
        targetPostgresVersion: "17.5",
        targetDatabaseDoesNotExist: true
      },
      requiredExternalSecrets: [
        "BETTER_AUTH_SECRET",
        "DAOFLOW_RECOVERY_ENCRYPTION_KEY",
        "DAOFLOW_RECOVERY_VERIFY_EMAIL",
        "DAOFLOW_RECOVERY_VERIFY_PASSWORD",
        "ENCRYPTION_KEY"
      ],
      verification: { email: "restore-check@example.test" }
    });
    expect(first.plan.planHash).toBe(second.plan.planHash);
    expect(JSON.stringify(first.plan)).not.toContain(KEY);
    expect(JSON.stringify(first.plan)).not.toContain("verify-password-value");
    expect(JSON.stringify(first.plan)).not.toContain("local-postgres-password");
    expect(Object.keys(first.plan.preflight.executionSecretFingerprints)).toEqual([
      "BETTER_AUTH_SECRET",
      "DAOFLOW_RECOVERY_ENCRYPTION_KEY",
      "DAOFLOW_RECOVERY_VERIFY_EMAIL",
      "DAOFLOW_RECOVERY_VERIFY_PASSWORD",
      "ENCRYPTION_KEY",
      "POSTGRES_PASSWORD"
    ]);
    for (const value of Object.values(first.plan.preflight.executionSecretFingerprints)) {
      expect(value).toMatch(/^[a-f0-9]{64}$/);
    }
    expect(Object.keys(first.secrets).sort()).toEqual(first.plan.requiredExternalSecrets);

    writeSecrets(input.secretsPath, { authSecret: "rotated-auth-secret" });
    const changedSecret = await inspectWithPreflight(input);
    expect(changedSecret.plan.planHash).not.toBe(first.plan.planHash);

    writeFileSync(
      join(fixture.root, ".env"),
      "DAOFLOW_VERSION=0.9.2\nDAOFLOW_DATABASE_NAME=legacy_daoflow\nPOSTGRES_PASSWORD=rotated-postgres-password\n"
    );
    const changedEnvironment = await inspectWithPreflight(input);
    expect(changedEnvironment.plan.planHash).not.toBe(changedSecret.plan.planHash);
    expect(
      changedEnvironment.plan.preflight.executionSecretFingerprints.POSTGRES_PASSWORD
    ).not.toBe(first.plan.preflight.executionSecretFingerprints.POSTGRES_PASSWORD);

    writeInstallation(fixture.root, { composeSuffix: "# changed after dry run\n" });
    const changedCompose = await inspectWithPreflight(input);
    expect(changedCompose.plan.planHash).not.toBe(changedEnvironment.plan.planHash);

    await first.cleanup();
    await second.cleanup();
    await changedSecret.cleanup();
    await changedEnvironment.cleanup();
    await changedCompose.cleanup();
  });

  test("rejects protected-secret, compatibility, compose, and database-target failures before execution", async () => {
    const fixture = writeFixture();
    writeInstallation(fixture.root);
    const secretsPath = join(fixture.root, "recovery-secrets.env");
    writeSecrets(secretsPath);
    const input = { ...fixture, secretsPath, installDir: fixture.root };

    chmodSync(secretsPath, 0o640);
    await expectInspectionFailure(() => inspectWithPreflight(input), "group or other");

    chmodSync(secretsPath, 0o600);
    writeFileSync(
      join(fixture.root, ".env"),
      "DAOFLOW_VERSION=1.0.0\nDAOFLOW_DATABASE_NAME=legacy_daoflow\nPOSTGRES_PASSWORD=local-postgres-password\n"
    );
    await expectInspectionFailure(
      () => inspectWithPreflight(input),
      "outside the recovery bundle compatibility range"
    );

    writeInstallation(fixture.root);
    await expectInspectionFailure(
      () => inspectWithPreflight({ ...input, targetDatabase: "legacy_daoflow" }),
      "new, non-reserved"
    );

    writeFileSync(
      join(fixture.root, "docker-compose.yml"),
      "services:\n  daoflow:\n    image: ghcr.io/daoflow-dev/daoflow:0.9.2\n    environment:\n      DATABASE_URL: postgresql://daoflow@postgres:5432/daoflow\n"
    );
    await expectInspectionFailure(
      () => inspectWithPreflight(input),
      "does not support DAOFLOW_DATABASE_NAME"
    );
  });

  test("rejects a missing required external secret without revealing any supplied value", async () => {
    const fixture = writeFixture();
    writeInstallation(fixture.root);
    const secretsPath = join(fixture.root, "recovery-secrets.env");
    writeFileSync(
      `${secretsPath}`,
      `DAOFLOW_RECOVERY_ENCRYPTION_KEY=${KEY}\nENCRYPTION_KEY=external-encryption-value\nDAOFLOW_RECOVERY_VERIFY_EMAIL=restore-check@example.test\n`,
      { mode: 0o600 }
    );

    try {
      await inspectWithPreflight({
        ...fixture,
        secretsPath,
        installDir: fixture.root
      });
      throw new Error("expected inspection to fail");
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      expect(message).toContain("DAOFLOW_RECOVERY_VERIFY_PASSWORD");
      expect(message).not.toContain(KEY);
      expect(message).not.toContain("external-encryption-value");
    }
  });

  test("confirms PostgreSQL compatibility and target absence before the plan", async () => {
    const fixture = writeFixture();
    writeInstallation(fixture.root);
    const input = {
      ...fixture,
      secretsPath: join(fixture.root, "recovery-secrets.env"),
      installDir: fixture.root
    };
    writeSecrets(input.secretsPath);

    const incompatibleCalls: string[] = [];
    await expectInspectionFailure(
      () => inspectWithPreflight(input, { calls: incompatibleCalls, postgresVersion: "16.9" }),
      "PostgreSQL major version mismatch"
    );
    expect(incompatibleCalls).toEqual(["require-postgres", "read-postgres-version"]);

    const existingTargetCalls: string[] = [];
    await expectInspectionFailure(
      () => inspectWithPreflight(input, { calls: existingTargetCalls, databaseExists: true }),
      "already exists; refusing to overwrite"
    );
    expect(existingTargetCalls).toEqual([
      "require-postgres",
      "read-postgres-version",
      "check-database-absence"
    ]);
  });

  test("uses Semantic Versioning prerelease precedence and rejects invalid versions", () => {
    const precedence = [
      "1.0.0-alpha",
      "1.0.0-alpha.1",
      "1.0.0-alpha.beta",
      "1.0.0-beta",
      "1.0.0-beta.2",
      "1.0.0-beta.11",
      "1.0.0-rc.1",
      "1.0.0"
    ];
    for (let index = 0; index < precedence.length - 1; index += 1) {
      expect(compareSemanticVersions(precedence[index], precedence[index + 1])).toBe(-1);
    }
    expect(compareSemanticVersions("v1.0.0+build.9", "1.0.0+build.10")).toBe(0);
    for (const invalid of ["1.0.0-01", "1.0.0-alpha..1", "1.0.0+", "1.0.0-"]) {
      expect(() => compareSemanticVersions(invalid, "1.0.0")).toThrow(
        "Left semantic version is not a valid semantic version."
      );
    }
  });
});

function writeInstallation(root: string, options: { composeSuffix?: string } = {}): void {
  writeFileSync(
    join(root, ".env"),
    "DAOFLOW_VERSION=0.9.2\nDAOFLOW_DATABASE_NAME=legacy_daoflow\nPOSTGRES_PASSWORD=local-postgres-password\n"
  );
  writeFileSync(
    join(root, "docker-compose.yml"),
    "services:\n  daoflow:\n    image: ghcr.io/daoflow-dev/daoflow:${DAOFLOW_VERSION:-0.9.2}\n    environment:\n      DATABASE_URL: postgresql://daoflow@postgres:5432/${DAOFLOW_DATABASE_NAME:-daoflow}\n" +
      (options.composeSuffix ?? "")
  );
}

function writeSecrets(path: string, options: { authSecret?: string } = {}): void {
  writeFileSync(
    path,
    `BETTER_AUTH_SECRET=${options.authSecret ?? "external-auth-secret"}\nDAOFLOW_RECOVERY_ENCRYPTION_KEY=${KEY}\nENCRYPTION_KEY=external-encryption-value\nDAOFLOW_RECOVERY_VERIFY_EMAIL=restore-check@example.test\nDAOFLOW_RECOVERY_VERIFY_PASSWORD=verify-password-value\n`,
    { mode: 0o600 }
  );
  chmodSync(path, 0o600);
}

function writeFixture() {
  const root = mkdtempSync(join(tmpdir(), "daoflow-recovery-restore-plan-"));
  roots.push(root);
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
  const header = Buffer.concat([Buffer.from("DFCPR"), Buffer.from([1]), Buffer.alloc(12, 4)]);
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
    bundleId: manifest.bundleId,
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
  return { root, bundlePath, sidecarPath };
}

function sha256(value: Buffer): string {
  return createHash("sha256").update(value).digest("hex");
}

function inspectWithPreflight(
  input: Parameters<typeof inspectControlPlaneRecoveryRestore>[0],
  options: { calls?: string[]; postgresVersion?: string; databaseExists?: boolean } = {}
) {
  return inspectControlPlaneRecoveryRestore(input, {
    ...controlPlaneRecoveryRestorePlanDependencies,
    requirePostgres: () => {
      options.calls?.push("require-postgres");
      return "postgres-container";
    },
    readPostgresVersion: () => {
      options.calls?.push("read-postgres-version");
      return options.postgresVersion ?? "17.5";
    },
    databaseExists: () => {
      options.calls?.push("check-database-absence");
      return options.databaseExists ?? false;
    }
  });
}

async function expectInspectionFailure(
  inspect: () => Promise<unknown>,
  expectedMessage: string
): Promise<void> {
  try {
    await inspect();
  } catch (error) {
    expect(error instanceof Error ? error.message : String(error)).toContain(expectedMessage);
    return;
  }
  throw new Error(`Expected recovery inspection to fail with: ${expectedMessage}`);
}
