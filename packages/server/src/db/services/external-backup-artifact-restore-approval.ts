import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { approvalRequests } from "../schema/audit";
import { backupRestores } from "../schema/storage";
import { startExternalArtifactRestoreWorkflow } from "../../worker";
import { isTemporalEnabled } from "../../worker/temporal/temporal-config";
import type {
  ExternalArtifactRestoreApproval,
  ExternalArtifactRestoreApprovalSnapshot
} from "../../worker/temporal/external-artifact-workflow-input";
import { writeExternalBackupArtifactAudit } from "./external-backup-artifact-audit";
import {
  ExternalBackupArtifactError,
  toExternalBackupArtifactView,
  type ExternalArtifactActor
} from "./external-backup-artifact-shared";
import { resolveExternalArtifactRestoreTarget } from "./external-backup-artifact-read";
import { readString } from "./json-helpers";

type ResolvedExternalRestoreTarget = NonNullable<
  Awaited<ReturnType<typeof resolveExternalArtifactRestoreTarget>>
>;

export async function buildExternalArtifactRestorePlan(input: {
  artifactId: string;
  targetVolumeId: string;
  teamId: string;
}) {
  const target = await resolveExternalArtifactRestoreTarget(input);
  if (!target) return null;
  const artifact = toExternalBackupArtifactView(target.artifact, target.destination.name);
  const isReady = target.artifact.status === "verified" && Boolean(target.artifact.verifiedAt);
  return {
    isReady,
    artifact,
    target: {
      id: target.volume.id,
      name: target.volume.name,
      serverId: target.volume.serverId,
      mountPath: target.volume.mountPath,
      databaseEngine: "postgres" as const,
      databaseName: target.databaseName,
      databaseUser: target.databaseUser
    },
    preflightChecks: [
      {
        status: isReady ? ("ok" as const) : ("warn" as const),
        detail: isReady
          ? "The external artifact passed isolated PostgreSQL restore verification."
          : "The external artifact must pass isolated verification before production restore."
      },
      {
        status: "ok" as const,
        detail: "The target volume belongs to this team and declares PostgreSQL database metadata."
      },
      {
        status: "ok" as const,
        detail: "Production restore will require a durable approval before it is queued."
      }
    ],
    steps: [
      "Confirm the selected external artifact and its isolated verification result.",
      "Request an approval for this exact artifact and target volume.",
      "After approval, download the pinned object again and restore it to the selected PostgreSQL target."
    ],
    approvalRequest: {
      actionType: "external-artifact-restore" as const,
      artifactId: target.artifact.id,
      targetVolumeId: target.volume.id,
      reason:
        "Describe why restoring this verified external PostgreSQL artifact is safe and necessary."
    }
  };
}

export async function queueExternalArtifactRestore(input: {
  artifactId: string;
  targetVolumeId: string;
  teamId: string;
  actor: ExternalArtifactActor;
  approvalRequestId: string;
  approvalDispatchId: string;
  operationId: string;
  approvalSnapshot: Record<string, unknown>;
  preserveDispatchRetry?: boolean;
}) {
  if (!isTemporalEnabled())
    throw new ExternalBackupArtifactError("External restore requires Temporal mode.");
  const target = await resolveExternalArtifactRestoreTarget(input);
  if (!target || target.artifact.status !== "verified" || !target.artifact.sha256) return null;
  const approval = await resolveExternalRestoreApproval(input, target);
  if (!approval) return null;

  const now = new Date();
  const restore = await db.transaction(async (tx) => {
    const [created] = await tx
      .insert(backupRestores)
      .values({
        id: input.operationId,
        backupRunId: null,
        externalArtifactId: target.artifact.id,
        targetVolumeId: target.volume.id,
        mode: "restore",
        status: "queued",
        targetPath: target.volume.mountPath,
        triggeredByUserId: input.actor.userId,
        startedAt: now,
        createdAt: now
      })
      .onConflictDoNothing()
      .returning();
    const persisted =
      created ??
      (
        await tx
          .select()
          .from(backupRestores)
          .where(eq(backupRestores.id, input.operationId))
          .limit(1)
      )[0];
    if (
      !persisted ||
      persisted.externalArtifactId !== target.artifact.id ||
      persisted.targetVolumeId !== target.volume.id ||
      persisted.mode !== "restore"
    ) {
      throw new ExternalBackupArtifactError(
        "Restore operation is already bound to a different target."
      );
    }
    return persisted;
  });

  try {
    const workflow = await startExternalArtifactRestoreWorkflow({
      artifactId: target.artifact.id,
      restoreId: restore.id,
      targetVolumeId: target.volume.id,
      approval
    });
    await writeExternalBackupArtifactAudit({
      actor: input.actor,
      teamId: input.teamId,
      destinationId: target.destination.id,
      artifactId: target.artifact.id,
      objectKey: target.artifact.objectKey,
      action: "external-artifact.restore.queued",
      permissionScope: "backup:restore",
      outcome: "success",
      detail: "Queued approved external PostgreSQL backup artifact restore."
    });
    return { ...restore, workflowId: workflow.workflowId };
  } catch (error) {
    if (input.preserveDispatchRetry) throw error;
    await db
      .update(backupRestores)
      .set({
        status: "failed",
        error: "Restore workflow could not be started.",
        completedAt: new Date()
      })
      .where(eq(backupRestores.id, restore.id));
    throw error;
  }
}

export function buildExternalRestoreApprovalSnapshot(
  target: ResolvedExternalRestoreTarget
): ExternalArtifactRestoreApprovalSnapshot {
  return {
    artifactId: target.artifact.id,
    artifactSha256: target.artifact.sha256 ?? "",
    artifactObjectKey: target.artifact.objectKey,
    artifactObjectVersion: target.artifact.objectVersion ?? "",
    artifactObjectEtag: target.artifact.objectEtag ?? "",
    artifactVerifiedAt: target.artifact.verifiedAt?.toISOString() ?? "",
    destinationId: target.destination.id,
    destinationUpdatedAt: target.destination.updatedAt.toISOString(),
    targetVolumeId: target.volume.id,
    targetVolumeUpdatedAt: target.volume.updatedAt.toISOString(),
    targetServerId: target.volume.serverId,
    targetMountPath: target.volume.mountPath,
    targetServiceId: target.targetServiceId,
    targetServiceUpdatedAt: target.targetServiceUpdatedAt,
    runtimeServiceName: target.runtimeServiceName,
    databaseEngine: "postgres",
    databaseName: target.databaseName,
    databaseUser: target.databaseUser,
    secretPolicy: "destination-credentials-encrypted"
  };
}

async function resolveExternalRestoreApproval(
  input: Parameters<typeof queueExternalArtifactRestore>[0],
  target: ResolvedExternalRestoreTarget
): Promise<ExternalArtifactRestoreApproval | null> {
  const snapshot = readExternalRestoreApprovalSnapshot(input.approvalSnapshot);
  if (!snapshot) return null;
  const [request] = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(
      and(
        eq(approvalRequests.id, input.approvalRequestId),
        eq(approvalRequests.teamId, input.teamId),
        eq(approvalRequests.actionType, "external-artifact-restore"),
        eq(approvalRequests.targetResource, `external-backup-artifact/${input.artifactId}`),
        eq(approvalRequests.status, "approved")
      )
    )
    .limit(1);
  if (!request || !externalRestoreSnapshotMatches(snapshot, target)) return null;
  return { approvalRequestId: request.id, expectedTeamId: input.teamId, snapshot };
}

function readExternalRestoreApprovalSnapshot(
  value: Record<string, unknown>
): ExternalArtifactRestoreApprovalSnapshot | null {
  const read = (key: string) => readString(value, key);
  const snapshot = {
    artifactId: read("artifactId"),
    artifactSha256: read("artifactSha256"),
    artifactObjectKey: read("artifactObjectKey"),
    artifactObjectVersion: read("artifactObjectVersion"),
    artifactObjectEtag: read("artifactObjectEtag"),
    artifactVerifiedAt: read("artifactVerifiedAt"),
    destinationId: read("destinationId"),
    destinationUpdatedAt: read("destinationUpdatedAt"),
    targetVolumeId: read("targetVolumeId"),
    targetVolumeUpdatedAt: read("targetVolumeUpdatedAt"),
    targetServerId: read("targetServerId"),
    targetMountPath: read("targetMountPath"),
    targetServiceId: read("targetServiceId"),
    targetServiceUpdatedAt: read("targetServiceUpdatedAt"),
    runtimeServiceName: read("runtimeServiceName"),
    databaseEngine: read("databaseEngine"),
    databaseName: read("databaseName"),
    databaseUser: read("databaseUser"),
    secretPolicy: read("secretPolicy")
  };
  const required = [
    snapshot.artifactId,
    snapshot.artifactSha256,
    snapshot.artifactObjectKey,
    snapshot.artifactVerifiedAt,
    snapshot.destinationId,
    snapshot.destinationUpdatedAt,
    snapshot.targetVolumeId,
    snapshot.targetVolumeUpdatedAt,
    snapshot.targetServerId,
    snapshot.targetMountPath,
    snapshot.targetServiceId,
    snapshot.targetServiceUpdatedAt,
    snapshot.runtimeServiceName,
    snapshot.databaseEngine,
    snapshot.databaseName,
    snapshot.databaseUser,
    snapshot.secretPolicy
  ];
  if (
    required.some((item) => !item) ||
    (!snapshot.artifactObjectVersion && !snapshot.artifactObjectEtag) ||
    snapshot.databaseEngine !== "postgres" ||
    snapshot.secretPolicy !== "destination-credentials-encrypted"
  ) {
    return null;
  }
  return snapshot as ExternalArtifactRestoreApprovalSnapshot;
}

function externalRestoreSnapshotMatches(
  snapshot: ExternalArtifactRestoreApprovalSnapshot,
  target: ResolvedExternalRestoreTarget
) {
  const current = buildExternalRestoreApprovalSnapshot(target);
  return (Object.keys(current) as Array<keyof ExternalArtifactRestoreApprovalSnapshot>).every(
    (key) => snapshot[key] === current[key]
  );
}
