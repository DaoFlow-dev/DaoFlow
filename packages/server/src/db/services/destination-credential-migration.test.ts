import { eq, sql } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import { db } from "../connection";
import { backupDestinations } from "../schema/destinations";
import {
  decryptDestinationCredentials,
  encryptDestinationCredentials,
  getDestinationCredentialKeyId
} from "./destination-credentials";
import { migrateBackupDestinationCredentials } from "./destination-credential-migration";

const currentKey = "current-destination-key-material-for-tests";
const previousKey = "previous-destination-key-material-for-tests";

async function loadDestination(id: string) {
  const [row] = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, id))
    .limit(1);
  if (!row) throw new Error(`Missing destination ${id}`);
  return row;
}

async function insertPreMigrationLegacyDestination() {
  await db.execute(
    sql.raw(
      'ALTER TABLE "backup_destinations" DROP CONSTRAINT "backup_destinations_credentials_state_check"'
    )
  );
  await db.insert(backupDestinations).values({
    id: "dest_legacy_credentials",
    teamId: "team_foundation",
    name: "Legacy S3",
    provider: "s3",
    accessKey: "legacy-access-key",
    secretAccessKey: "legacy-secret-key",
    oauthToken: '{"access_token":"legacy-oauth"}',
    rcloneConfig: "[remote]\ntype = s3\nsecret = legacy-config-secret\n",
    encryptionPassword: "legacy-backup-password",
    encryptionSalt: "legacy-backup-salt",
    updatedAt: new Date()
  });
  await db.execute(
    sql.raw(`
      ALTER TABLE "backup_destinations"
      ADD CONSTRAINT "backup_destinations_credentials_state_check"
      CHECK (
        "access_key" IS NULL
        AND "secret_access_key" IS NULL
        AND "oauth_token" IS NULL
        AND "rclone_config" IS NULL
        AND "encryption_password" IS NULL
        AND "encryption_salt" IS NULL
        AND (
          (
            "credentials_encrypted" IS NULL
            AND "credential_envelope_version" IS NULL
            AND "credential_key_id" IS NULL
          )
          OR
          (
            "credentials_encrypted" IS NOT NULL
            AND "credential_envelope_version" IS NOT NULL
            AND "credential_key_id" IS NOT NULL
          )
        )
      ) NOT VALID
    `)
  );
}

describe("backup destination credential migration", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("transactionally migrates legacy plaintext credentials and clears every secret column", async () => {
    await insertPreMigrationLegacyDestination();

    await expect(
      migrateBackupDestinationCredentials({
        currentKeyMaterial: currentKey,
        previousKeyMaterial: null
      })
    ).resolves.toEqual({ scanned: 1, migrated: 1, rotated: 0, verified: 1 });

    const row = await loadDestination("dest_legacy_credentials");
    expect(row).toMatchObject({
      accessKey: null,
      secretAccessKey: null,
      oauthToken: null,
      rcloneConfig: null,
      encryptionPassword: null,
      encryptionSalt: null,
      credentialEnvelopeVersion: 1,
      credentialKeyId: getDestinationCredentialKeyId(currentKey)
    });
    expect(row.credentialsEncrypted).not.toContain("legacy-secret-key");
    expect(decryptDestinationCredentials(row, currentKey)).toEqual({
      accessKey: "legacy-access-key",
      secretAccessKey: "legacy-secret-key",
      oauthToken: '{"access_token":"legacy-oauth"}',
      rcloneConfig: "[remote]\ntype = s3\nsecret = legacy-config-secret\n",
      encryptionPassword: "legacy-backup-password",
      encryptionSalt: "legacy-backup-salt"
    });

    const constraint = await db.execute<{ convalidated: boolean }>(sql`
      SELECT convalidated
      FROM pg_constraint
      WHERE conname = 'backup_destinations_credentials_state_check'
    `);
    expect(constraint.rows[0]?.convalidated).toBe(true);

    await expect(async () =>
      db.insert(backupDestinations).values({
        id: "dest_plaintext_reintroduced",
        teamId: "team_foundation",
        name: "Rejected plaintext",
        provider: "s3",
        accessKey: "must-not-return",
        updatedAt: new Date()
      })
    ).rejects.toMatchObject({
      cause: {
        code: "23514",
        constraint: "backup_destinations_credentials_state_check"
      }
    });
  });

  it("rotates envelopes from the configured previous key to the current key", async () => {
    const previousEnvelope = encryptDestinationCredentials(
      { accessKey: "rotate-access", secretAccessKey: "rotate-secret" },
      previousKey
    );
    await db.insert(backupDestinations).values({
      id: "dest_rotate_credentials",
      teamId: "team_foundation",
      name: "Rotating S3",
      provider: "s3",
      ...previousEnvelope,
      updatedAt: new Date()
    });

    await expect(
      migrateBackupDestinationCredentials({
        currentKeyMaterial: currentKey,
        previousKeyMaterial: previousKey
      })
    ).resolves.toEqual({ scanned: 1, migrated: 0, rotated: 1, verified: 1 });

    const row = await loadDestination("dest_rotate_credentials");
    expect(row.credentialKeyId).toBe(getDestinationCredentialKeyId(currentKey));
    expect(decryptDestinationCredentials(row, currentKey)).toEqual({
      accessKey: "rotate-access",
      secretAccessKey: "rotate-secret"
    });
  });

  it("fails with an actionable message when the previous key is missing", async () => {
    const previousEnvelope = encryptDestinationCredentials(
      { oauthToken: '{"access_token":"old-token"}' },
      previousKey
    );
    await db.insert(backupDestinations).values({
      id: "dest_missing_previous_key",
      teamId: "team_foundation",
      name: "Old Drive",
      provider: "gdrive",
      ...previousEnvelope,
      updatedAt: new Date()
    });

    await expect(
      migrateBackupDestinationCredentials({
        currentKeyMaterial: currentKey,
        previousKeyMaterial: null
      })
    ).rejects.toThrow("DAOFLOW_PREVIOUS_BACKUP_DESTINATION_ENCRYPTION_KEY");

    expect((await loadDestination("dest_missing_previous_key")).credentialKeyId).toBe(
      getDestinationCredentialKeyId(previousKey)
    );
  });

  it("rolls back all planned rotations when any destination envelope is invalid", async () => {
    const previousEnvelope = encryptDestinationCredentials(
      { accessKey: "must-remain-old" },
      previousKey
    );
    await db.insert(backupDestinations).values([
      {
        id: "dest_rotation_rollback",
        teamId: "team_foundation",
        name: "Rollback S3",
        provider: "s3",
        ...previousEnvelope,
        updatedAt: new Date()
      },
      {
        id: "dest_invalid_credentials",
        teamId: "team_foundation",
        name: "Invalid S3",
        provider: "s3",
        credentialsEncrypted: "invalid-ciphertext",
        credentialEnvelopeVersion: 1,
        credentialKeyId: getDestinationCredentialKeyId(previousKey),
        updatedAt: new Date()
      }
    ]);

    await expect(
      migrateBackupDestinationCredentials({
        currentKeyMaterial: currentKey,
        previousKeyMaterial: previousKey
      })
    ).rejects.toThrow("credential rotation failed");

    const unchanged = await loadDestination("dest_rotation_rollback");
    expect(unchanged.credentialKeyId).toBe(getDestinationCredentialKeyId(previousKey));
    expect(decryptDestinationCredentials(unchanged, previousKey)).toEqual({
      accessKey: "must-remain-old"
    });
  });

  it("rejects mixed plaintext and encrypted writes at the database boundary", async () => {
    const encrypted = encryptDestinationCredentials({ accessKey: "encrypted-access" }, currentKey);

    await expect(async () =>
      db.insert(backupDestinations).values({
        id: "dest_mixed_credentials",
        teamId: "team_foundation",
        name: "Mixed S3",
        provider: "s3",
        ...encrypted,
        accessKey: "unexpected-plaintext",
        updatedAt: new Date()
      })
    ).rejects.toMatchObject({
      cause: {
        code: "23514",
        constraint: "backup_destinations_credentials_state_check"
      }
    });
  });
});
