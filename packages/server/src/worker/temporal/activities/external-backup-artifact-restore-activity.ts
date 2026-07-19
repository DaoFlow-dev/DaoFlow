import { and, eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import { approvalRequests } from "../../../db/schema/audit";
import { backupRestores, volumes } from "../../../db/schema/storage";
import { resolveVolumeTeamId } from "../../../db/services/backup-resource-team";
import {
  resolveExternalPostgresRestoreRuntime,
  resolveExternalPostgresTargetMetadata
} from "../../../db/services/external-backup-artifact-read";
import { asRecord, readString } from "../../../db/services/json-helpers";
import { resolveMemberRoleForTeam } from "../../../db/services/teams";
import { writeExternalBackupArtifactAudit } from "../../../db/services/external-backup-artifact-audit";
import type {
  ExternalArtifactRestoreApproval,
  ExternalArtifactRestoreWorkflowInput
} from "../external-artifact-workflow-input";
import {
  downloadExternalArtifact,
  loadExternalArtifactContext,
  temporalExternalArtifactHooks,
  type ExternalArtifactContext
} from "./external-backup-artifact-activity-shared";
import {
  createExternalArtifactWorkspace,
  removeExternalArtifactWorkspace,
  safeExternalArtifactError
} from "./external-backup-artifact-runtime";
import { executeDatabaseRestore } from "./restore-database";
import { withPreparedExecutionTarget } from "../../execution-target";

export async function executeExternalArtifactRestore(
  input: ExternalArtifactRestoreWorkflowInput
): Promise<void> {
  const context = await loadExternalArtifactContext(input.artifactId);
  const [volume] = await db
    .select()
    .from(volumes)
    .where(eq(volumes.id, input.targetVolumeId))
    .limit(1);
  if (!context || !volume) {
    await markExternalRestoreFailed(
      input.restoreId,
      "External restore target is no longer available."
    );
    return;
  }

  const workDir = createExternalArtifactWorkspace(input.restoreId);
  let restoredSuccessfully = false;
  let operationError: Error | null = null;
  try {
    try {
      await revalidateExternalRestoreApproval(context, volume, input.approval);
      if (context.artifact.status !== "verified" || !context.artifact.sha256) {
        throw new Error("External artifact is no longer verified for production restore.");
      }
      await markExternalRestoreRunning(input.restoreId);
      const downloaded = await downloadExternalArtifact(context, workDir);
      if (downloaded.sha256 !== context.artifact.sha256) {
        throw new Error(
          "Pinned external backup object checksum no longer matches its registration."
        );
      }
      await revalidateExternalRestoreApproval(context, volume, input.approval);
      const runtime = await resolveExternalPostgresRestoreRuntime({
        volume,
        teamId: context.artifact.teamId,
        restoreId: input.restoreId
      });
      if (!runtime) {
        throw new Error(
          "Selected PostgreSQL target is no longer available on its approved server."
        );
      }
      const restored = await withPreparedExecutionTarget(runtime.target, (target) =>
        executeDatabaseRestore(
          {
            databaseEngine: "postgres",
            databasePassword:
              readString(asRecord(volume.metadata), "databasePassword") || undefined,
            databaseUser: runtime.databaseUser,
            databaseName: runtime.databaseName,
            volumeName: volume.name,
            executionTarget: target,
            runtime: runtime.runtime
          },
          downloaded.path,
          temporalExternalArtifactHooks()
        )
      );
      if (!restored.success) throw new Error(restored.error ?? "External database restore failed.");
      await db
        .update(backupRestores)
        .set({ status: "succeeded", error: null, completedAt: new Date() })
        .where(eq(backupRestores.id, input.restoreId));
      restoredSuccessfully = true;
      await writeExternalRestoreAudit({
        teamId: context.artifact.teamId,
        destinationId: context.artifact.destinationId,
        artifactId: context.artifact.id,
        objectKey: context.artifact.objectKey,
        action: "external-artifact.restore.succeeded",
        permissionScope: "backup:restore",
        outcome: "success",
        detail:
          "Approved external PostgreSQL backup artifact was restored to its selected target volume."
      });
    } catch (error) {
      const message = safeExternalArtifactError(error);
      await markExternalRestoreFailed(input.restoreId, message);
      await writeExternalRestoreAudit({
        teamId: context.artifact.teamId,
        destinationId: context.artifact.destinationId,
        artifactId: context.artifact.id,
        objectKey: context.artifact.objectKey,
        action: "external-artifact.restore.failed",
        permissionScope: "backup:restore",
        outcome: "failure",
        detail: "Approved external PostgreSQL backup artifact restore failed."
      });
      operationError = new Error(message);
    }
  } finally {
    let cleanupError: string | null;
    try {
      cleanupError = removeExternalArtifactWorkspace(workDir);
    } catch (error) {
      cleanupError = safeExternalArtifactError(error);
    }
    if (cleanupError) {
      await writeExternalRestoreAudit({
        teamId: context.artifact.teamId,
        destinationId: context.artifact.destinationId,
        artifactId: context.artifact.id,
        objectKey: context.artifact.objectKey,
        action: "external-artifact.restore.cleanup-failed",
        permissionScope: "backup:restore",
        outcome: "failure",
        detail: restoredSuccessfully
          ? "External artifact restore succeeded, but temporary workspace cleanup failed."
          : "External artifact restore temporary workspace cleanup failed."
      });
    }
  }

  if (operationError) throw operationError;
}

async function writeExternalRestoreAudit(
  input: Parameters<typeof writeExternalBackupArtifactAudit>[0]
): Promise<void> {
  try {
    await writeExternalBackupArtifactAudit(input);
  } catch (error) {
    console.warn(
      JSON.stringify({
        event: "external-artifact.restore.audit-write-failed",
        action: input.action,
        error: safeExternalArtifactError(error)
      })
    );
  }
}

async function revalidateExternalRestoreApproval(
  context: ExternalArtifactContext,
  volume: typeof volumes.$inferSelect,
  approval: ExternalArtifactRestoreApproval
): Promise<void> {
  const [request] = await db
    .select({ resolvedByUserId: approvalRequests.resolvedByUserId })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.id, approval.approvalRequestId),
        eq(approvalRequests.teamId, approval.expectedTeamId),
        eq(approvalRequests.actionType, "external-artifact-restore"),
        eq(approvalRequests.targetResource, `external-backup-artifact/${context.artifact.id}`),
        eq(approvalRequests.status, "approved")
      )
    )
    .limit(1);
  if (!request?.resolvedByUserId) throw new Error("External restore approval is no longer valid.");
  const role = await resolveMemberRoleForTeam(request.resolvedByUserId, approval.expectedTeamId);
  if (role !== "owner" && role !== "admin") {
    throw new Error("The approving actor no longer has decision authority for this team.");
  }
  if ((await resolveVolumeTeamId(volume)) !== approval.expectedTeamId) {
    throw new Error("External restore target no longer belongs to the approved team.");
  }
  const target = await requirePostgresTargetMetadata(volume, approval.expectedTeamId);
  const snapshot = approval.snapshot;
  const matches =
    context.artifact.teamId === approval.expectedTeamId &&
    context.artifact.status === "verified" &&
    snapshot.secretPolicy === "destination-credentials-encrypted" &&
    snapshot.artifactId === context.artifact.id &&
    snapshot.artifactSha256 === context.artifact.sha256 &&
    snapshot.artifactObjectKey === context.artifact.objectKey &&
    snapshot.artifactObjectVersion === (context.artifact.objectVersion ?? "") &&
    snapshot.artifactObjectEtag === (context.artifact.objectEtag ?? "") &&
    snapshot.artifactVerifiedAt === (context.artifact.verifiedAt?.toISOString() ?? "") &&
    snapshot.destinationId === context.destination.id &&
    snapshot.destinationUpdatedAt === context.destination.updatedAt.toISOString() &&
    snapshot.targetVolumeId === volume.id &&
    snapshot.targetVolumeUpdatedAt === volume.updatedAt.toISOString() &&
    snapshot.targetServerId === volume.serverId &&
    snapshot.targetMountPath === volume.mountPath &&
    snapshot.targetServiceId === target.targetServiceId &&
    snapshot.targetServiceUpdatedAt === target.targetServiceUpdatedAt &&
    snapshot.runtimeServiceName === target.runtimeServiceName &&
    snapshot.databaseEngine === "postgres" &&
    snapshot.databaseName === target.databaseName &&
    snapshot.databaseUser === target.databaseUser;
  if (!matches) {
    throw new Error(
      "External restore approval no longer matches its immutable artifact and target snapshot."
    );
  }
}

async function requirePostgresTargetMetadata(volume: typeof volumes.$inferSelect, teamId: string) {
  const metadata = await resolveExternalPostgresTargetMetadata(volume, teamId);
  if (!metadata)
    throw new Error("Selected target volume is missing required PostgreSQL database metadata.");
  return metadata;
}

async function markExternalRestoreRunning(restoreId: string) {
  await db
    .update(backupRestores)
    .set({ status: "running", error: null, startedAt: new Date(), completedAt: null })
    .where(eq(backupRestores.id, restoreId));
}

async function markExternalRestoreFailed(restoreId: string, error: string) {
  await db
    .update(backupRestores)
    .set({ status: "failed", error, completedAt: new Date() })
    .where(eq(backupRestores.id, restoreId));
}
