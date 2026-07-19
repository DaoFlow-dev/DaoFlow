import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { toDestinationConfig } from "../../../db/services/destination-shared";
import { backupDestinations } from "../../../db/schema/destinations";
import type { ExternalS3Destination } from "../../external-backup-s3";

export function createExternalArtifactWorkspace(id: string): string {
  return mkdtempSync(join(tmpdir(), `daoflow-external-${id}-`));
}

export function removeExternalArtifactWorkspace(path: string): string | null {
  try {
    rmSync(path, { recursive: true, force: true });
    return null;
  } catch {
    return "Temporary artifact workspace could not be removed.";
  }
}

export function toExternalArtifactS3Destination(
  destination: typeof backupDestinations.$inferSelect
): ExternalS3Destination {
  const config = toDestinationConfig(destination);
  return {
    id: destination.id,
    provider: config.provider,
    bucket: config.bucket ?? null,
    region: config.region ?? null,
    endpoint: config.endpoint ?? null,
    accessKey: config.accessKey ?? null,
    secretAccessKey: config.secretAccessKey ?? null,
    encryptionMode: config.encryptionMode ?? "none",
    externalImportEnabled: destination.externalImportEnabled,
    externalImportPrefix: destination.externalImportPrefix,
    maxExternalImportBytes: destination.maxExternalImportBytes
  };
}

export function safeExternalArtifactError(error: unknown): string {
  const message =
    error instanceof Error ? error.message : "External backup artifact operation failed.";
  return message
    .replace(/([a-z][a-z0-9+.-]*:\/\/)[^\s/@]+(?::[^\s/@]+)?@/gi, "$1[redacted]@")
    .replace(
      /\b(password|passwd|secret|token|api[_-]?key|credential)\s*([=:])\s*[^\s,;]+/gi,
      "$1$2[redacted]"
    )
    .slice(0, 500);
}
