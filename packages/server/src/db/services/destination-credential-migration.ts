import { eq, sql } from "drizzle-orm";
import { db } from "../connection";
import { backupDestinations } from "../schema/destinations";
import {
  decryptDestinationCredentials,
  encryptDestinationCredentials,
  getDestinationCredentialKeyId,
  getLegacyDestinationCredentials,
  hasEncryptedDestinationCredentials,
  hasLegacyDestinationCredentials,
  reencryptDestinationCredentials,
  resolveDestinationCredentialKeyMaterial,
  resolvePreviousDestinationCredentialKeyMaterial,
  type EncryptedDestinationCredentials
} from "./destination-credentials";

export interface DestinationCredentialMigrationReport {
  scanned: number;
  migrated: number;
  rotated: number;
  verified: number;
}

interface DestinationCredentialMigrationOptions {
  currentKeyMaterial?: string;
  previousKeyMaterial?: string | null;
}

const clearedLegacyCredentials = {
  accessKey: null,
  secretAccessKey: null,
  oauthToken: null,
  rcloneConfig: null,
  encryptionPassword: null,
  encryptionSalt: null
} as const;

function destinationError(destinationId: string, message: string): Error {
  return new Error(`Backup destination ${destinationId}: ${message}`);
}

export async function migrateBackupDestinationCredentials(
  options: DestinationCredentialMigrationOptions = {}
): Promise<DestinationCredentialMigrationReport> {
  const currentKeyMaterial =
    options.currentKeyMaterial ?? resolveDestinationCredentialKeyMaterial();
  const previousKeyMaterial =
    options.previousKeyMaterial === undefined
      ? resolvePreviousDestinationCredentialKeyMaterial()
      : options.previousKeyMaterial;
  const currentKeyId = getDestinationCredentialKeyId(currentKeyMaterial);
  const previousKeyId = previousKeyMaterial
    ? getDestinationCredentialKeyId(previousKeyMaterial)
    : null;

  return db.transaction(async (tx) => {
    await tx.execute(sql`LOCK TABLE ${backupDestinations} IN ACCESS EXCLUSIVE MODE`);
    const rows = await tx.select().from(backupDestinations).orderBy(backupDestinations.id);
    const updates: Array<{
      id: string;
      encrypted: EncryptedDestinationCredentials;
      kind: "migrated" | "rotated";
    }> = [];
    let verified = 0;

    for (const row of rows) {
      const hasLegacy = hasLegacyDestinationCredentials(row);
      const hasEncrypted = hasEncryptedDestinationCredentials(row);

      if (hasLegacy && hasEncrypted) {
        throw destinationError(
          row.id,
          "credentials are in a mixed plaintext and encrypted state; repair the row before startup."
        );
      }

      if (hasLegacy) {
        let encrypted: EncryptedDestinationCredentials;
        try {
          encrypted = encryptDestinationCredentials(
            getLegacyDestinationCredentials(row),
            currentKeyMaterial
          );
          decryptDestinationCredentials(encrypted, currentKeyMaterial);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw destinationError(row.id, `legacy credentials could not be migrated: ${message}`);
        }
        updates.push({ id: row.id, encrypted, kind: "migrated" });
        continue;
      }

      if (!hasEncrypted) {
        try {
          decryptDestinationCredentials(row, currentKeyMaterial);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw destinationError(row.id, message);
        }
        continue;
      }

      if (row.credentialKeyId === currentKeyId) {
        try {
          decryptDestinationCredentials(row, currentKeyMaterial);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          throw destinationError(row.id, `credential verification failed: ${message}`);
        }
        verified += 1;
        continue;
      }

      if (!previousKeyMaterial || row.credentialKeyId !== previousKeyId) {
        throw destinationError(
          row.id,
          "credentials use an unknown encryption key. Set DAOFLOW_PREVIOUS_BACKUP_DESTINATION_ENCRYPTION_KEY to the matching old destination key and retry."
        );
      }

      let encrypted: EncryptedDestinationCredentials;
      try {
        encrypted = reencryptDestinationCredentials(row, previousKeyMaterial, currentKeyMaterial);
        decryptDestinationCredentials(encrypted, currentKeyMaterial);
      } catch (error) {
        const message = error instanceof Error ? error.message : String(error);
        throw destinationError(row.id, `credential rotation failed: ${message}`);
      }
      updates.push({ id: row.id, encrypted, kind: "rotated" });
    }

    for (const update of updates) {
      await tx
        .update(backupDestinations)
        .set({
          ...update.encrypted,
          ...clearedLegacyCredentials,
          updatedAt: new Date()
        })
        .where(eq(backupDestinations.id, update.id));
    }

    await tx.execute(
      sql.raw(
        'ALTER TABLE "backup_destinations" VALIDATE CONSTRAINT "backup_destinations_credentials_state_check"'
      )
    );

    const migrated = updates.filter((update) => update.kind === "migrated").length;
    const rotated = updates.length - migrated;
    return {
      scanned: rows.length,
      migrated,
      rotated,
      verified: verified + updates.length
    };
  });
}
