import type { AppRole } from "@daoflow/shared";
import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { backupDestinations } from "../schema/destinations";
import { externalBackupArtifacts } from "../schema/external-backup-artifacts";
import { toDestinationConfig } from "./destination-shared";
import type { ExternalS3Destination } from "../../worker/external-backup-s3";

export type ExternalArtifactActor = { userId: string; email: string; role: AppRole };
export type ExternalArtifactRow = typeof externalBackupArtifacts.$inferSelect;
export type ExternalDestinationRow = typeof backupDestinations.$inferSelect;

export class ExternalBackupArtifactError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "ExternalBackupArtifactError";
  }
}

export function toExternalBackupArtifactView(
  artifact: ExternalArtifactRow,
  destinationName: string
) {
  return {
    id: artifact.id,
    origin: "external" as const,
    destinationId: artifact.destinationId,
    destinationName,
    objectKey: artifact.objectKey,
    objectVersion: artifact.objectVersion,
    objectEtag: artifact.objectEtag,
    sizeBytes: Number(artifact.sizeBytes),
    sha256: artifact.sha256,
    artifactFormat: artifact.archiveFormat,
    databaseEngineVersion: artifact.sourcePostgresVersion,
    status: artifact.status,
    error: artifact.registerError,
    registeredAt: artifact.registeredAt?.toISOString() ?? null,
    updatedAt: artifact.updatedAt.toISOString(),
    verifiedAt: artifact.verifiedAt?.toISOString() ?? null,
    latestVerification: artifact.latestVerification ?? null
  };
}

export async function requireExternalDestination(destinationId: string, teamId: string) {
  const [destination] = await db
    .select()
    .from(backupDestinations)
    .where(and(eq(backupDestinations.id, destinationId), eq(backupDestinations.teamId, teamId)))
    .limit(1);
  if (!destination) throw new ExternalBackupArtifactError("Destination not found.");
  return destination;
}

export async function resolveExternalArtifact(artifactId: string, teamId: string) {
  const [row] = await db
    .select({ artifact: externalBackupArtifacts, destination: backupDestinations })
    .from(externalBackupArtifacts)
    .innerJoin(backupDestinations, eq(backupDestinations.id, externalBackupArtifacts.destinationId))
    .where(
      and(eq(externalBackupArtifacts.id, artifactId), eq(externalBackupArtifacts.teamId, teamId))
    )
    .limit(1);
  return row ?? null;
}

export function toExternalS3Destination(
  destination: ExternalDestinationRow
): ExternalS3Destination {
  let config;
  try {
    config = toDestinationConfig(destination);
  } catch {
    throw new ExternalBackupArtifactError(
      "Destination credentials are unavailable for external import."
    );
  }
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

export function assertPostgresMajor(value: string): void {
  if (!/^[1-9]\d*$/.test(value.trim())) {
    throw new ExternalBackupArtifactError("PostgreSQL major version must be a positive integer.");
  }
}

export function asExternalArtifactError(error: unknown): ExternalBackupArtifactError {
  return error instanceof ExternalBackupArtifactError
    ? error
    : new ExternalBackupArtifactError(
        error instanceof Error ? error.message : "External backup artifact operation failed."
      );
}
