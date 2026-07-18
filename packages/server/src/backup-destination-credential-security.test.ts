import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db/connection";
import { encryptWithKeyMaterial, getEncryptionKeyId } from "./db/crypto";
import { auditEntries } from "./db/schema/audit";
import { backupDestinations } from "./db/schema/destinations";
import { migrateBackupDestinationCredentials } from "./db/services/destination-credential-migration";
import { getDestinationConfig } from "./db/services/destinations";
import { appRouter } from "./router";
import { runStartupMigrations } from "./startup-migrations";
import { resetStartupReadiness } from "./startup-readiness";
import { resetTestDatabaseWithControlPlane } from "./test-db";
import { makeSession } from "./testing/request-auth-fixtures";

const secrets = [
  "api-access-key",
  "api-secret-key",
  "api-oauth-token",
  "api-rclone-secret",
  "api-encryption-password",
  "api-encryption-salt"
] as const;

function ownerCaller(requestId: string) {
  return appRouter.createCaller({ requestId, session: makeSession("owner") });
}

function expectNoSecrets(value: unknown) {
  const serialized = JSON.stringify(value);
  for (const secret of secrets) {
    expect(serialized).not.toContain(secret);
  }
}

describe("backup destination credential security boundaries", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  afterEach(() => {
    resetStartupReadiness();
    vi.restoreAllMocks();
  });

  it("keeps submitted secrets out of API responses and audit records", async () => {
    const caller = ownerCaller("destination-secret-boundaries");
    const created = await caller.createBackupDestination({
      name: "Security boundary destination",
      provider: "gdrive",
      accessKey: secrets[0],
      secretAccessKey: secrets[1],
      oauthToken: JSON.stringify({ access_token: secrets[2] }),
      rcloneConfig: `[remote]\ntype = drive\nsecret = ${secrets[3]}\n`,
      encryptionMode: "rclone-crypt",
      encryptionPassword: secrets[4],
      encryptionSalt: secrets[5]
    });

    const [detail, list, audits, stored] = await Promise.all([
      caller.backupDestination({ destinationId: created.id }),
      caller.backupDestinations({}),
      db.select().from(auditEntries),
      db.select().from(backupDestinations).where(eq(backupDestinations.id, created.id)).limit(1)
    ]);

    expectNoSecrets({ created, detail, list, audits });
    expect(stored[0]).toMatchObject({
      accessKey: null,
      secretAccessKey: null,
      oauthToken: null,
      rcloneConfig: null,
      encryptionPassword: null,
      encryptionSalt: null
    });
    expectNoSecrets(stored[0]?.credentialsEncrypted);
  });

  it("serializes concurrent edits so stale credentials cannot be restored", async () => {
    const caller = ownerCaller("destination-concurrent-update");
    const destination = await caller.createBackupDestination({
      name: "Concurrent destination",
      provider: "s3",
      accessKey: "initial-access-key"
    });

    await Promise.all([
      caller.updateBackupDestination({ id: destination.id, name: "Renamed destination" }),
      caller.updateBackupDestination({ id: destination.id, accessKey: "rotated-access-key" })
    ]);

    const [detail, config] = await Promise.all([
      caller.backupDestination({ destinationId: destination.id }),
      getDestinationConfig(destination.id, "team_foundation")
    ]);
    expect(detail.name).toBe("Renamed destination");
    expect(config?.accessKey).toBe("rotated-access-key");
  });

  it("does not write decrypted malformed-envelope content to startup logs", async () => {
    const keyMaterial = "startup-malformed-envelope-key-material";
    const plaintextSecret = "must-never-reach-startup-logs";
    await db.insert(backupDestinations).values({
      id: "dest_malformed_startup_envelope",
      teamId: "team_foundation",
      name: "Malformed envelope",
      provider: "s3",
      credentialsEncrypted: encryptWithKeyMaterial(
        `{"version":1,"accessKey":"${plaintextSecret}"`,
        keyMaterial
      ),
      credentialEnvelopeVersion: 1,
      credentialKeyId: getEncryptionKeyId(keyMaterial),
      updatedAt: new Date()
    });
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    vi.spyOn(console, "warn").mockImplementation(() => undefined);

    await runStartupMigrations({
      isProduction: false,
      runMigrations: () => Promise.resolve(),
      runCredentialMigration: () =>
        migrateBackupDestinationCredentials({
          currentKeyMaterial: keyMaterial,
          previousKeyMaterial: null
        })
    });

    const logged = JSON.stringify(consoleError.mock.calls);
    expect(logged).toContain("Destination credential envelope payload is invalid.");
    expect(logged).not.toContain(plaintextSecret);
  });
});
