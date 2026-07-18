import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../connection";
import { backupDestinations } from "../schema/destinations";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import {
  decryptDestinationCredentials,
  encryptDestinationCredentials,
  hasEncryptedDestinationCredentials,
  hasLegacyDestinationCredentials,
  reencryptDestinationCredentials,
  resolveDestinationCredentialKeyMaterial,
  resolvePreviousDestinationCredentialKeyMaterial
} from "./destination-credentials";
import {
  createDestination,
  getDestinationConfig,
  testDestinationConnection,
  updateDestination
} from "./destinations";

const rcloneMocks = vi.hoisted(() => ({
  testConnection: vi.fn()
}));

vi.mock("../../worker/rclone-executor", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../worker/rclone-executor")>()),
  testConnection: rcloneMocks.testConnection
}));

const actor = {
  userId: "user_foundation_owner",
  email: "owner@daoflow.local",
  role: "owner" as const
};

describe("destinations", () => {
  beforeEach(async () => {
    rcloneMocks.testConnection.mockReset();
    await resetTestDatabaseWithControlPlane();
  });

  it("encrypts new destination credentials without retaining plaintext", async () => {
    const destination = await createDestination(
      {
        name: "Drive backups",
        provider: "gdrive",
        accessKey: "access-key-1234",
        secretAccessKey: "secret-access-key-1234",
        oauthToken: '{\n  "access_token": "token-1",\n  "refresh_token": "refresh-1"\n}',
        rcloneConfig: "[remote]\ntype = drive\ntoken = token-1\n",
        encryptionMode: "rclone-crypt",
        encryptionPassword: "backup-password-1234",
        encryptionSalt: "backup-salt-1234",
        filenameEncryption: "obfuscate"
      },
      "team_foundation",
      actor.userId,
      actor.email,
      actor.role
    );

    const [storedDestination] = await db
      .select()
      .from(backupDestinations)
      .where(eq(backupDestinations.id, destination.id))
      .limit(1);

    expect(storedDestination).toBeDefined();
    expect(storedDestination).toMatchObject({
      accessKey: null,
      secretAccessKey: null,
      oauthToken: null,
      rcloneConfig: null,
      encryptionPassword: null,
      encryptionSalt: null,
      credentialEnvelopeVersion: 1
    });
    expect(storedDestination?.credentialKeyId).toBeTruthy();
    expect(storedDestination?.credentialsEncrypted).toBeTruthy();
    expect(hasLegacyDestinationCredentials(storedDestination)).toBe(false);
    expect(hasEncryptedDestinationCredentials(storedDestination)).toBe(true);

    for (const secret of [
      "access-key-1234",
      "secret-access-key-1234",
      "token-1",
      "[remote]\ntype = drive\ntoken = token-1\n",
      "backup-password-1234",
      "backup-salt-1234"
    ]) {
      expect(storedDestination?.credentialsEncrypted).not.toContain(secret);
    }

    expect(decryptDestinationCredentials(storedDestination)).toEqual({
      accessKey: "access-key-1234",
      secretAccessKey: "secret-access-key-1234",
      oauthToken: '{"access_token":"token-1","refresh_token":"refresh-1"}',
      rcloneConfig: "[remote]\ntype = drive\ntoken = token-1\n",
      encryptionPassword: "backup-password-1234",
      encryptionSalt: "backup-salt-1234"
    });
    expect(destination).not.toHaveProperty("accessKey");
    expect(destination).toMatchObject({ hasCredentials: true });
  });

  it("decrypts credentials for worker configuration and preserves unspecified secrets on update", async () => {
    const destination = await createDestination(
      {
        name: "S3 backups",
        provider: "s3",
        accessKey: "access-key-1",
        secretAccessKey: "secret-key-1",
        rcloneConfig: "[remote]\ntype = sftp\n",
        encryptionMode: "rclone-crypt",
        encryptionPassword: "password-1",
        encryptionSalt: "salt-1"
      },
      "team_foundation",
      actor.userId,
      actor.email,
      actor.role
    );

    const config = await getDestinationConfig(destination.id, "team_foundation");
    expect(config).toMatchObject({
      accessKey: "access-key-1",
      secretAccessKey: "secret-key-1",
      rcloneConfig: "[remote]\ntype = sftp\n",
      encryptionMode: "rclone-crypt",
      encryptionPassword: "password-1",
      encryptionSalt: "salt-1"
    });

    await updateDestination(
      {
        id: destination.id,
        accessKey: "access-key-2",
        encryptionPassword: null,
        encryptionSalt: ""
      },
      "team_foundation",
      actor.userId,
      actor.email,
      actor.role
    );

    const [storedDestination] = await db
      .select()
      .from(backupDestinations)
      .where(eq(backupDestinations.id, destination.id))
      .limit(1);

    expect(storedDestination).toMatchObject({
      accessKey: null,
      secretAccessKey: null,
      oauthToken: null,
      rcloneConfig: null,
      encryptionPassword: null,
      encryptionSalt: null
    });
    expect(decryptDestinationCredentials(storedDestination)).toEqual({
      accessKey: "access-key-2",
      secretAccessKey: "secret-key-1",
      rcloneConfig: "[remote]\ntype = sftp\n"
    });
  });

  it("rejects invalid OAuth token JSON without changing stored credentials", async () => {
    const destination = await createDestination(
      {
        name: "Drive backups",
        provider: "gdrive",
        oauthToken: '{"access_token":"token-1"}'
      },
      "team_foundation",
      actor.userId,
      actor.email,
      actor.role
    );

    const [beforeUpdate] = await db
      .select()
      .from(backupDestinations)
      .where(eq(backupDestinations.id, destination.id))
      .limit(1);

    await expect(
      updateDestination(
        {
          id: destination.id,
          oauthToken: "{not-json"
        },
        "team_foundation",
        actor.userId,
        actor.email,
        actor.role
      )
    ).rejects.toThrow("Invalid OAuth token: must be valid JSON from 'rclone authorize'.");

    const [storedDestination] = await db
      .select()
      .from(backupDestinations)
      .where(eq(backupDestinations.id, destination.id))
      .limit(1);

    expect(storedDestination?.credentialsEncrypted).toBe(beforeUpdate?.credentialsEncrypted);
    expect(decryptDestinationCredentials(storedDestination)).toEqual({
      oauthToken: '{"access_token":"token-1"}'
    });
  });

  it("re-encrypts credential envelopes with explicit old and new keys", () => {
    const oldKey = "old-destination-encryption-key-material";
    const newKey = "new-destination-encryption-key-material";
    const encrypted = encryptDestinationCredentials({ accessKey: "access-key-1" }, oldKey);

    const rotated = reencryptDestinationCredentials(encrypted, oldKey, newKey);

    expect(rotated.credentialKeyId).not.toBe(encrypted.credentialKeyId);
    expect(decryptDestinationCredentials(rotated, newKey)).toEqual({ accessKey: "access-key-1" });
    expect(() => decryptDestinationCredentials(rotated, oldKey)).toThrow(
      "Destination credential envelope was encrypted with a different key"
    );
  });

  it("uses the destination-only encryption keys before the application fallback", () => {
    const currentDestinationKey = "destination-current-key-material-1234567890";
    const previousDestinationKey = "destination-previous-key-material-123456789";
    const applicationKey = "application-key-material-12345678901234567890";

    expect(
      resolveDestinationCredentialKeyMaterial({
        NODE_ENV: "production",
        DAOFLOW_BACKUP_DESTINATION_ENCRYPTION_KEY: currentDestinationKey,
        ENCRYPTION_KEY: applicationKey
      })
    ).toBe(currentDestinationKey);
    expect(
      resolvePreviousDestinationCredentialKeyMaterial({
        NODE_ENV: "production",
        DAOFLOW_PREVIOUS_BACKUP_DESTINATION_ENCRYPTION_KEY: previousDestinationKey
      })
    ).toBe(previousDestinationKey);
    expect(
      resolveDestinationCredentialKeyMaterial({
        NODE_ENV: "production",
        ENCRYPTION_KEY: applicationKey
      })
    ).toBe(applicationKey);
  });

  it("redacts configured credentials from connection-test output and errors", async () => {
    const accessKey = "access-key-connection-test";
    const secretAccessKey = "secret-key-connection-test";
    const oauthToken = '{"access_token":"oauth-connection-test"}';
    const rcloneConfig = "[remote]\ntype = sftp\npassword = config-connection-test\n";
    const encryptionPassword = "password-connection-test";
    const encryptionSalt = "salt-connection-test";
    const destination = await createDestination(
      {
        name: "Connection test destination",
        provider: "sftp",
        accessKey,
        secretAccessKey,
        oauthToken,
        rcloneConfig,
        encryptionPassword,
        encryptionSalt
      },
      "team_foundation",
      actor.userId,
      actor.email,
      actor.role
    );

    rcloneMocks.testConnection.mockReturnValue({
      success: false,
      output: `output ${accessKey} ${secretAccessKey} oauth-connection-test config-connection-test ${encryptionPassword} ${encryptionSalt}`,
      error: `error ${accessKey} ${secretAccessKey} ${oauthToken} ${rcloneConfig} ${encryptionPassword} ${encryptionSalt}`,
      exitCode: 1
    });

    const result = await testDestinationConnection(destination.id, "team_foundation");

    const returnedText = `${result.output}\n${result.error ?? ""}`;
    for (const secret of [
      accessKey,
      secretAccessKey,
      oauthToken,
      rcloneConfig,
      "oauth-connection-test",
      "config-connection-test",
      encryptionPassword,
      encryptionSalt
    ]) {
      expect(returnedText).not.toContain(secret);
    }
    expect(returnedText).toContain("[redacted]");
    expect(rcloneMocks.testConnection).toHaveBeenCalledWith(
      expect.objectContaining({
        accessKey,
        secretAccessKey,
        oauthToken,
        rcloneConfig,
        encryptionPassword,
        encryptionSalt
      })
    );
  });
});
