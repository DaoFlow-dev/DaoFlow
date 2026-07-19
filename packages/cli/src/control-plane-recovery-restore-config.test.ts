import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, statSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  buildRecoveryEnvironment,
  redactRecoveryRestoreError,
  writeRecoveryConfigSnapshot,
  writeRecoveryEnvironmentAtomically
} from "./control-plane-recovery-restore-config";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("control-plane recovery restore configuration", () => {
  test("switches only the target database and manifest-required secrets", () => {
    const contents = buildRecoveryEnvironment({
      originalContents:
        "DAOFLOW_DATABASE_NAME=daoflow\nBETTER_AUTH_SECRET=clean\nENCRYPTION_KEY=clean-key\nDAOFLOW_INITIAL_ADMIN_EMAIL=clean@example.test\nDAOFLOW_INITIAL_ADMIN_PASSWORD=clean-pass\n",
      targetDatabase: "daoflow_restore_cprb_123",
      requiredExternalSecrets: ["BETTER_AUTH_SECRET", "ENCRYPTION_KEY"],
      externalSecrets: {
        BETTER_AUTH_SECRET: "source secret",
        ENCRYPTION_KEY: "source-encryption-key-that-is-long-enough",
        DAOFLOW_RECOVERY_VERIFY_EMAIL: "owner@example.test",
        DAOFLOW_RECOVERY_VERIFY_PASSWORD: "must-not-be-persisted"
      }
    });

    expect(contents).toContain("DAOFLOW_DATABASE_NAME=daoflow_restore_cprb_123");
    expect(contents).toContain("BETTER_AUTH_SECRET='source secret'");
    expect(contents).toContain("ENCRYPTION_KEY=source-encryption-key-that-is-long-enough");
    expect(contents).toContain("DAOFLOW_INITIAL_ADMIN_EMAIL=\n");
    expect(contents).toContain("DAOFLOW_INITIAL_ADMIN_PASSWORD=\n");
    expect(contents).not.toContain("must-not-be-persisted");
    expect(contents).not.toContain("DAOFLOW_RECOVERY_VERIFY_EMAIL");
  });

  test("writes switch and rollback files with owner-only permissions", () => {
    const directory = mkdtempSync(join(tmpdir(), "daoflow-restore-config-"));
    temporaryDirectories.push(directory);
    const envPath = join(directory, ".env");

    writeRecoveryEnvironmentAtomically(envPath, "DAOFLOW_DATABASE_NAME=restored\n");
    const snapshotPath = writeRecoveryConfigSnapshot({
      installDir: directory,
      originalContents: "DAOFLOW_DATABASE_NAME=daoflow\n",
      timestamp: new Date("2026-07-18T12:34:56.000Z")
    });

    expect(readFileSync(envPath, "utf8")).toContain("restored");
    expect(readFileSync(snapshotPath, "utf8")).toContain("daoflow");
    expect(statSync(envPath).mode & 0o777).toBe(0o600);
    expect(statSync(snapshotPath).mode & 0o777).toBe(0o600);
  });

  test("redacts database credentials, external secrets, and session tokens", () => {
    const databasePassword = "db password/with?characters";
    const encodedDatabasePassword = encodeURIComponent(databasePassword);
    const externalSecret = "source-external-secret";
    const sessionToken = "session-token-value";
    const message = redactRecoveryRestoreError(
      new Error(
        `restore failed postgresql://daoflow:${encodedDatabasePassword}@postgres:5432/daoflow password=${databasePassword} external=${externalSecret} better-auth.session_token=${sessionToken} Authorization: Bearer ${sessionToken}`
      ),
      {
        databasePasswords: [databasePassword],
        secrets: { EXTERNAL_SECRET: externalSecret }
      }
    );

    expect(message).toContain("[redacted database URL]");
    expect(message).not.toContain(databasePassword);
    expect(message).not.toContain(encodedDatabasePassword);
    expect(message).not.toContain(externalSecret);
    expect(message).not.toContain(sessionToken);
  });
});
