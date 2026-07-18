import type { BackupProvider, backupDestinations } from "../schema/destinations";
import type { DestinationConfig } from "../../worker/rclone-executor";

export type DestinationRow = typeof backupDestinations.$inferSelect;

export interface CreateDestinationInput {
  name: string;
  provider: BackupProvider;
  accessKey?: string;
  secretAccessKey?: string;
  bucket?: string;
  region?: string;
  endpoint?: string;
  s3Provider?: string;
  rcloneType?: string;
  rcloneConfig?: string;
  rcloneRemotePath?: string;
  oauthToken?: string;
  localPath?: string;
}

export interface UpdateDestinationInput extends Partial<CreateDestinationInput> {
  id: string;
}

export function toDestinationConfig(row: DestinationRow): DestinationConfig {
  return {
    id: row.id,
    provider: row.provider as BackupProvider,
    accessKey: row.accessKey,
    secretAccessKey: row.secretAccessKey,
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    s3Provider: row.s3Provider,
    rcloneType: row.rcloneType,
    rcloneConfig: row.rcloneConfig,
    rcloneRemotePath: row.rcloneRemotePath,
    oauthToken: row.oauthToken,
    localPath: row.localPath
  };
}

export function sanitizeOauthToken(
  oauthToken: string | null | undefined
): string | null | undefined {
  if (oauthToken === undefined) {
    return undefined;
  }

  if (oauthToken === null || oauthToken.length === 0) {
    return null;
  }

  try {
    return JSON.stringify(JSON.parse(oauthToken));
  } catch {
    throw new Error("Invalid OAuth token: must be valid JSON from 'rclone authorize'.");
  }
}

function maskSecret(value: string | null): string | null {
  if (!value || value.length < 8) return value ? "****" : null;
  return "****" + value.slice(-4);
}

export function toPublicDestinationView(row: DestinationRow) {
  return {
    id: row.id,
    name: row.name,
    provider: row.provider,
    accessKey: maskSecret(row.accessKey),
    bucket: row.bucket,
    region: row.region,
    endpoint: row.endpoint,
    s3Provider: row.s3Provider,
    rcloneType: row.rcloneType,
    rcloneRemotePath: row.rcloneRemotePath,
    localPath: row.localPath,
    lastTestedAt: row.lastTestedAt?.toISOString() ?? null,
    lastTestResult: row.lastTestResult,
    createdAt: row.createdAt.toISOString(),
    updatedAt: row.updatedAt.toISOString()
  };
}
