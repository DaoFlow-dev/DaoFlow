import { and, eq, isNull } from "drizzle-orm";
import { db } from "../connection";
import { externalBackupArtifacts } from "../schema/external-backup-artifacts";
import { backupRestores } from "../schema/storage";
import {
  buildExternalArtifactImportWorkflowId,
  startExternalArtifactImportWorkflow,
  startExternalArtifactVerificationWorkflow
} from "../../worker";
import { isTemporalEnabled } from "../../worker/temporal/temporal-config";
import { createExternalS3Adapter } from "../../worker/external-backup-s3";
import { writeExternalBackupArtifactAudit } from "./external-backup-artifact-audit";
import {
  asExternalArtifactError,
  assertPostgresMajor,
  requireExternalDestination,
  resolveExternalArtifact,
  toExternalBackupArtifactView,
  toExternalS3Destination,
  type ExternalArtifactActor
} from "./external-backup-artifact-shared";
import { newId as id } from "./json-helpers";

export async function listExternalBackupObjects(input: {
  destinationId: string;
  prefix?: string;
  teamId: string;
  actor: ExternalArtifactActor;
}) {
  const destination = await requireExternalDestination(input.destinationId, input.teamId);
  try {
    const result = await createExternalS3Adapter(toExternalS3Destination(destination)).listObjects(
      input.prefix
    );
    await writeExternalBackupArtifactAudit({
      actor: input.actor,
      teamId: input.teamId,
      destinationId: destination.id,
      action: "external-artifact.list",
      permissionScope: "backup:read",
      outcome: "success",
      detail: "Listed external backup objects under the approved import prefix."
    });
    return {
      destination: {
        id: destination.id,
        name: destination.name,
        provider: destination.provider,
        externalImportEnabled: destination.externalImportEnabled,
        externalImportPrefix: destination.externalImportPrefix,
        maxExternalImportBytes: Number(destination.maxExternalImportBytes)
      },
      prefix: result.prefix,
      objects: result.objects
    };
  } catch (error) {
    await writeExternalBackupArtifactAudit({
      actor: input.actor,
      teamId: input.teamId,
      destinationId: input.destinationId,
      action: "external-artifact.list.denied",
      permissionScope: "backup:read",
      outcome: "denied",
      detail: "External backup object listing was denied."
    });
    throw asExternalArtifactError(error);
  }
}

export async function registerExternalBackupArtifact(input: {
  destinationId: string;
  objectKey: string;
  postgresMajor: string;
  teamId: string;
  actor: ExternalArtifactActor;
}) {
  if (!isTemporalEnabled()) {
    throw asExternalArtifactError(new Error("External backup imports require Temporal mode."));
  }
  const destination = await requireExternalDestination(input.destinationId, input.teamId);
  assertPostgresMajor(input.postgresMajor);
  try {
    const identity = await createExternalS3Adapter(toExternalS3Destination(destination)).headObject(
      input.objectKey
    );
    const existing = await findArtifactByIdentity(
      destination.id,
      identity.key,
      identity.versionId,
      identity.etag
    );
    const artifact =
      existing ??
      (
        await db
          .insert(externalBackupArtifacts)
          .values({
            id: id(),
            teamId: input.teamId,
            destinationId: destination.id,
            objectKey: identity.key,
            objectVersion: identity.versionId,
            objectEtag: identity.etag,
            sizeBytes: String(identity.size),
            contentType: identity.contentType,
            lastModified: identity.lastModified,
            sourcePostgresVersion: input.postgresMajor,
            status: "registering",
            registeredByUserId: input.actor.userId,
            createdAt: new Date(),
            updatedAt: new Date()
          })
          .returning()
      )[0];
    if (!artifact) throw new Error("External backup artifact could not be registered.");

    if (existing?.status === "failed") {
      const [requeued] = await db
        .update(externalBackupArtifacts)
        .set({
          status: "registering",
          registerError: null,
          sourcePostgresVersion: input.postgresMajor,
          registeredByUserId: input.actor.userId,
          updatedAt: new Date()
        })
        .where(eq(externalBackupArtifacts.id, existing.id))
        .returning();
      if (!requeued) throw new Error("External backup artifact retry could not be queued.");
      Object.assign(artifact, requeued);
    }

    let workflowId = buildExternalArtifactImportWorkflowId(artifact.id);
    if (artifact.status === "registering") {
      workflowId = (
        await startExternalArtifactImportWorkflow({
          artifactId: artifact.id,
          destinationUpdatedAt: destination.updatedAt.toISOString()
        })
      ).workflowId;
    }
    await writeExternalBackupArtifactAudit({
      actor: input.actor,
      teamId: input.teamId,
      destinationId: destination.id,
      artifactId: artifact.id,
      objectKey: identity.key,
      action: existing ? "external-artifact.import.reused" : "external-artifact.import.queued",
      permissionScope: "backup:restore",
      outcome: "success",
      detail: "Queued external PostgreSQL backup artifact registration."
    });
    return {
      artifact: toExternalBackupArtifactView(artifact, destination.name),
      workflowId,
      nextAction: "test-restore" as const
    };
  } catch (error) {
    await writeExternalBackupArtifactAudit({
      actor: input.actor,
      teamId: input.teamId,
      destinationId: input.destinationId,
      objectKey: input.objectKey,
      action: "external-artifact.import.denied",
      permissionScope: "backup:restore",
      outcome: "denied",
      detail: "External PostgreSQL backup artifact registration was denied."
    });
    throw asExternalArtifactError(error);
  }
}

export async function triggerExternalArtifactTestRestore(input: {
  artifactId: string;
  teamId: string;
  actor: ExternalArtifactActor;
}) {
  if (!isTemporalEnabled()) {
    throw asExternalArtifactError(
      new Error("External artifact verification requires Temporal mode.")
    );
  }
  const resolved = await resolveExternalArtifact(input.artifactId, input.teamId);
  if (!resolved || resolved.artifact.status !== "registered") {
    throw asExternalArtifactError(
      new Error("External artifact is not eligible for isolated verification.")
    );
  }
  const restoreId = id();
  const now = new Date();
  const restore = await db.transaction(async (tx) => {
    const [claimed] = await tx
      .update(externalBackupArtifacts)
      .set({ status: "verifying", registerError: null, updatedAt: now })
      .where(
        and(
          eq(externalBackupArtifacts.id, resolved.artifact.id),
          eq(externalBackupArtifacts.teamId, input.teamId),
          eq(externalBackupArtifacts.status, "registered")
        )
      )
      .returning({ id: externalBackupArtifacts.id });
    if (!claimed) return null;
    const [created] = await tx
      .insert(backupRestores)
      .values({
        id: restoreId,
        backupRunId: null,
        externalArtifactId: resolved.artifact.id,
        targetVolumeId: null,
        mode: "verification",
        status: "queued",
        targetPath: null,
        triggeredByUserId: input.actor.userId,
        startedAt: now,
        createdAt: now
      })
      .returning();
    return created ?? null;
  });
  if (!restore) {
    throw asExternalArtifactError(
      new Error("External artifact verification is already queued or running.")
    );
  }
  try {
    await startExternalArtifactVerificationWorkflow({
      artifactId: resolved.artifact.id,
      restoreId
    });
  } catch (error) {
    await db.transaction(async (tx) => {
      await tx
        .update(backupRestores)
        .set({
          status: "failed",
          error: "Verification workflow could not be started.",
          completedAt: new Date()
        })
        .where(eq(backupRestores.id, restoreId));
      await tx
        .update(externalBackupArtifacts)
        .set({ status: "registered", updatedAt: new Date() })
        .where(
          and(
            eq(externalBackupArtifacts.id, resolved.artifact.id),
            eq(externalBackupArtifacts.status, "verifying")
          )
        );
    });
    throw asExternalArtifactError(error);
  }
  await writeExternalBackupArtifactAudit({
    actor: input.actor,
    teamId: input.teamId,
    destinationId: resolved.destination.id,
    artifactId: resolved.artifact.id,
    objectKey: resolved.artifact.objectKey,
    action: "external-artifact.verify.queued",
    permissionScope: "backup:restore",
    outcome: "success",
    detail: "Queued an isolated external PostgreSQL backup artifact verification."
  });
  return {
    id: restore.id,
    artifactId: restore.externalArtifactId ?? resolved.artifact.id,
    status: restore.status
  };
}

async function findArtifactByIdentity(
  destinationId: string,
  objectKey: string,
  objectVersion: string | null,
  objectEtag: string | null
) {
  const where = objectVersion
    ? and(
        eq(externalBackupArtifacts.destinationId, destinationId),
        eq(externalBackupArtifacts.objectKey, objectKey),
        eq(externalBackupArtifacts.objectVersion, objectVersion)
      )
    : objectEtag
      ? and(
          eq(externalBackupArtifacts.destinationId, destinationId),
          eq(externalBackupArtifacts.objectKey, objectKey),
          isNull(externalBackupArtifacts.objectVersion),
          eq(externalBackupArtifacts.objectEtag, objectEtag)
        )
      : undefined;
  if (!where) return null;
  const [artifact] = await db.select().from(externalBackupArtifacts).where(where).limit(1);
  return artifact ?? null;
}
