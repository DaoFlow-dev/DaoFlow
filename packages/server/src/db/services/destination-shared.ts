import type { BackupProvider, backupDestinations } from "../schema/destinations";
import type { DestinationConfig } from "../../worker/rclone-executor";
import {
  DESTINATION_CREDENTIAL_FIELDS,
  decryptDestinationCredentials,
  getLegacyDestinationCredentials,
  hasEncryptedDestinationCredentials,
  hasLegacyDestinationCredentials,
  normalizeDestinationCredentials,
  normalizeDestinationOauthToken,
  type DestinationCredentials
} from "./destination-credentials";

export type DestinationRow = typeof backupDestinations.$inferSelect;

export interface CreateDestinationInput {
  name: string;
  provider: BackupProvider;
  accessKey?: string | null;
  secretAccessKey?: string | null;
  bucket?: string;
  region?: string;
  endpoint?: string;
  s3Provider?: string;
  rcloneType?: string;
  rcloneConfig?: string | null;
  rcloneRemotePath?: string;
  oauthToken?: string | null;
  encryptionMode?: string;
  encryptionPassword?: string | null;
  encryptionSalt?: string | null;
  filenameEncryption?: string;
  localPath?: string;
}

export interface UpdateDestinationInput extends Partial<CreateDestinationInput> {
  id: string;
}

export function mergeDestinationCredentials(
  existing: DestinationRow,
  input: UpdateDestinationInput
): DestinationCredentials {
  const hasLegacyCredentials = hasLegacyDestinationCredentials(existing);
  const hasEncryptedCredentials = hasEncryptedDestinationCredentials(existing);
  if (hasLegacyCredentials && hasEncryptedCredentials) {
    throw new Error(
      "Destination credentials are in a mixed plaintext and encrypted state. Complete credential migration before updating this destination."
    );
  }

  const merged = {
    ...(hasLegacyCredentials
      ? getLegacyDestinationCredentials(existing)
      : decryptDestinationCredentials(existing))
  };
  const updates = normalizeDestinationCredentials(input);

  for (const field of DESTINATION_CREDENTIAL_FIELDS) {
    if (input[field] === undefined) continue;

    const updatedValue = updates[field];
    if (updatedValue === undefined) {
      delete merged[field];
    } else {
      merged[field] = updatedValue;
    }
  }

  return merged;
}

export function toDestinationConfig(row: DestinationRow): DestinationConfig {
  const hasLegacyCredentials = hasLegacyDestinationCredentials(row);
  const hasEncryptedCredentials = hasEncryptedDestinationCredentials(row);
  if (hasLegacyCredentials && hasEncryptedCredentials) {
    throw new Error(
      "Destination credentials are in a mixed plaintext and encrypted state. Complete credential migration before using this destination."
    );
  }
  if (hasLegacyCredentials) {
    throw new Error(
      "Destination credentials are stored in legacy plaintext columns. Complete credential migration before using this destination."
    );
  }

  const credentials = decryptDestinationCredentials(row);
  return {
    id: row.id,
    provider: row.provider as BackupProvider,
    accessKey: credentials.accessKey ?? null,
    secretAccessKey: credentials.secretAccessKey ?? null,
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    s3Provider: row.s3Provider,
    rcloneType: row.rcloneType,
    rcloneConfig: credentials.rcloneConfig ?? null,
    rcloneRemotePath: row.rcloneRemotePath,
    oauthToken: credentials.oauthToken ?? null,
    encryptionMode: row.encryptionMode,
    encryptionPassword: credentials.encryptionPassword ?? null,
    encryptionSalt: credentials.encryptionSalt ?? null,
    filenameEncryption: row.filenameEncryption,
    localPath: row.localPath
  };
}

export function sanitizeOauthToken(
  oauthToken: string | null | undefined
): string | null | undefined {
  if (oauthToken === undefined) {
    return undefined;
  }

  return normalizeDestinationOauthToken(oauthToken) ?? null;
}

export function toPublicDestinationView(row: DestinationRow) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    hasCredentials: hasLegacyDestinationCredentials(row) || hasEncryptedDestinationCredentials(row),
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    s3Provider: row.s3Provider,
    rcloneType: row.rcloneType,
    rcloneRemotePath: row.rcloneRemotePath,
    encryptionMode: row.encryptionMode,
    filenameEncryption: row.filenameEncryption,
    localPath: row.localPath,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestResult: row.lastTestResult,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
