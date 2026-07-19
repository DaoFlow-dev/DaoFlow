import type { HeadObjectCommandOutput } from "@aws-sdk/client-s3";
import {
  ExternalS3Error,
  type ExternalS3Destination,
  type ExternalS3ObjectIdentity
} from "./external-backup-s3-types";

export function validateExternalS3Destination(destination: ExternalS3Destination) {
  if (!destination.externalImportEnabled) {
    throw new ExternalS3Error("External backup imports are disabled for this destination.");
  }
  if (destination.provider !== "s3") {
    throw new ExternalS3Error("External backup imports require an S3-compatible destination.");
  }
  if (destination.encryptionMode !== "none") {
    throw new ExternalS3Error(
      "External PostgreSQL imports require a destination without archive or rclone encryption."
    );
  }
  if (!destination.bucket?.trim() || !destination.accessKey || !destination.secretAccessKey) {
    throw new ExternalS3Error("External backup destination is missing S3 credentials or bucket.");
  }
  if (!destination.externalImportPrefix) {
    throw new ExternalS3Error("External backup destination is missing an approved import prefix.");
  }
  const maxImportBytes = Number(destination.maxExternalImportBytes);
  if (!Number.isSafeInteger(maxImportBytes) || maxImportBytes < 1) {
    throw new ExternalS3Error("External backup destination has an invalid import size limit.");
  }
  return {
    ...destination,
    bucket: destination.bucket.trim(),
    externalImportPrefix: normalizeExternalObjectPrefix(destination.externalImportPrefix),
    maxImportBytes
  };
}

export function normalizeExternalObjectKey(value: string): string {
  const trimmed = value.trim();
  if (!trimmed || trimmed.length > 1024) {
    throw new ExternalS3Error(
      "External backup object key must contain between 1 and 1024 characters."
    );
  }
  if (trimmed.startsWith("/") || trimmed.includes("\\") || hasControlCharacter(trimmed)) {
    throw new ExternalS3Error("External backup object key contains unsupported characters.");
  }
  const parts = trimmed.split("/");
  if (parts.some((part) => !part || part === "." || part === "..")) {
    throw new ExternalS3Error(
      "External backup object key must not contain traversal path segments."
    );
  }
  return parts.join("/");
}

export function resolveExternalObjectPrefix(
  approvedPrefix: string,
  requestedPrefix?: string
): string {
  if (!requestedPrefix) return approvedPrefix;
  const requested = normalizeExternalObjectPrefix(requestedPrefix);
  return requested.startsWith(approvedPrefix) ? requested : `${approvedPrefix}${requested}`;
}

export function assertObjectKeyWithinPrefix(key: string, approvedPrefix: string): void {
  if (!key.startsWith(approvedPrefix)) {
    throw new ExternalS3Error("External backup object is outside the approved import prefix.");
  }
}

export function normalizeObjectIdentity(
  key: string,
  output: HeadObjectCommandOutput,
  maxBytes: number
): ExternalS3ObjectIdentity {
  const size = output.ContentLength;
  if (typeof size !== "number" || !Number.isSafeInteger(size) || size < 1 || size > maxBytes) {
    throw new ExternalS3Error("External backup object exceeds the configured import size limit.");
  }
  const versionId = normalizeIdentityValue(output.VersionId);
  const etag = normalizeEtag(output.ETag);
  if (!versionId && !etag) {
    throw new ExternalS3Error("External backup object is missing a version ID and ETag.");
  }
  return {
    key,
    versionId,
    etag,
    size,
    contentType: normalizeMetadataValue(output.ContentType),
    lastModified: output.LastModified ?? null
  };
}

export function normalizeEtag(value: string | undefined): string | null {
  return normalizeBoundedValue(value, 512);
}

function normalizeExternalObjectPrefix(value: string): string {
  const key = normalizeExternalObjectKey(value.endsWith("/") ? value.slice(0, -1) : value);
  return `${key}/`;
}

function normalizeIdentityValue(value: string | undefined): string | null {
  return normalizeBoundedValue(value, 1024);
}

function normalizeMetadataValue(value: string | undefined): string | null {
  return normalizeBoundedValue(value, 255);
}

function normalizeBoundedValue(value: string | undefined, length: number): string | null {
  const normalized = value?.trim();
  return normalized && normalized.length <= length && !hasControlCharacter(normalized)
    ? normalized
    : null;
}

function hasControlCharacter(value: string): boolean {
  return [...value].some((character) => {
    const code = character.charCodeAt(0);
    return code <= 31 || code === 127;
  });
}
