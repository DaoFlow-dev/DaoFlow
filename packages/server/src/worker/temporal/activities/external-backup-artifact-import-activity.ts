import { eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import { externalBackupArtifacts } from "../../../db/schema/external-backup-artifacts";
import { writeExternalBackupArtifactAudit } from "../../../db/services/external-backup-artifact-audit";
import type { ExternalArtifactImportWorkflowInput } from "../external-artifact-workflow-input";
import {
  downloadExternalArtifact,
  loadExternalArtifactContext,
  temporalExternalArtifactHooks
} from "./external-backup-artifact-activity-shared";
import {
  createExternalArtifactWorkspace,
  removeExternalArtifactWorkspace,
  safeExternalArtifactError
} from "./external-backup-artifact-runtime";
import {
  inspectExternalPostgresCustomArchive,
  resolveOfficialPostgresVerifierImage
} from "./external-postgres-artifact";

export async function importExternalBackupArtifact(
  input: ExternalArtifactImportWorkflowInput
): Promise<void> {
  const context = await loadExternalArtifactContext(input.artifactId);
  if (!context || !["registering", "failed"].includes(context.artifact.status)) return;

  const workDir = createExternalArtifactWorkspace(input.artifactId);
  let registered = false;
  let operationError: Error | null = null;
  try {
    if (context.destination.updatedAt.toISOString() !== input.destinationUpdatedAt) {
      throw new Error("External import destination changed after object validation.");
    }
    if (context.artifact.status === "failed") {
      await db
        .update(externalBackupArtifacts)
        .set({ status: "registering", registerError: null, updatedAt: new Date() })
        .where(eq(externalBackupArtifacts.id, context.artifact.id));
    }
    const downloaded = await downloadExternalArtifact(context, workDir);
    const verifierImage = await resolveOfficialPostgresVerifierImage(
      context.artifact.sourcePostgresVersion,
      temporalExternalArtifactHooks()
    );
    const inspected = await inspectExternalPostgresCustomArchive({
      artifactId: context.artifact.id,
      dumpPath: downloaded.path,
      checksum: downloaded.sha256,
      expectedPostgresMajor: context.artifact.sourcePostgresVersion,
      verifierImage,
      verifierHooks: temporalExternalArtifactHooks()
    });
    const now = new Date();
    await db
      .update(externalBackupArtifacts)
      .set({
        sizeBytes: String(downloaded.bytes),
        sha256: downloaded.sha256,
        sourcePostgresVersion: inspected.sourcePostgresVersion,
        verifierImage,
        listingEvidence: inspected.listingEvidence,
        status: "registered",
        registerError: null,
        registeredAt: now,
        updatedAt: now
      })
      .where(eq(externalBackupArtifacts.id, context.artifact.id));
    registered = true;
    await writeExternalBackupArtifactAudit({
      teamId: context.artifact.teamId,
      destinationId: context.artifact.destinationId,
      artifactId: context.artifact.id,
      objectKey: context.artifact.objectKey,
      action: "external-artifact.import.succeeded",
      permissionScope: "backup:restore",
      outcome: "success",
      detail: "Registered external PostgreSQL backup artifact after isolated archive inspection."
    });
  } catch (error) {
    const message = safeExternalArtifactError(error);
    await db
      .update(externalBackupArtifacts)
      .set({ status: "failed", registerError: message, updatedAt: new Date() })
      .where(eq(externalBackupArtifacts.id, input.artifactId));
    await writeExternalBackupArtifactAudit({
      teamId: context.artifact.teamId,
      destinationId: context.artifact.destinationId,
      artifactId: context.artifact.id,
      objectKey: context.artifact.objectKey,
      action: "external-artifact.import.failed",
      permissionScope: "backup:restore",
      outcome: "failure",
      detail: "External PostgreSQL backup artifact registration failed."
    });
    operationError = new Error(message);
  }

  const cleanupError = removeExternalArtifactWorkspace(workDir);
  if (cleanupError) {
    await db
      .update(externalBackupArtifacts)
      .set({ status: "failed", registerError: cleanupError, updatedAt: new Date() })
      .where(eq(externalBackupArtifacts.id, context.artifact.id));
    await writeExternalBackupArtifactAudit({
      teamId: context.artifact.teamId,
      destinationId: context.artifact.destinationId,
      artifactId: context.artifact.id,
      objectKey: context.artifact.objectKey,
      action: "external-artifact.import.cleanup-failed",
      permissionScope: "backup:restore",
      outcome: "failure",
      detail: "External artifact registration temporary workspace cleanup failed."
    });
    if (registered) operationError = new Error(cleanupError);
  }

  if (operationError) throw operationError;
}
