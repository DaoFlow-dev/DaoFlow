import { and, eq } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { approvalRequests, auditEntries } from "../schema/audit";
import { backupRestores, backupRuns } from "../schema/storage";
import { startRestoreWorkflow } from "../../worker";
import { isTemporalEnabled } from "../../worker/temporal/temporal-config";
import type {
  RestoreApproval,
  RestoreApprovalSnapshot
} from "../../worker/temporal/restore-workflow-input";
import { getBackupRunDetails } from "./backup-run-details";
import { getPolicyView, loadBackupRelations } from "./backup-view-helpers";
import { resolveVolumeTeamId } from "./backup-resource-team";
import { newId as id } from "./json-helpers";

const POSTGRES_VERSION_PATTERN = /^(?<major>[1-9]\d*)(?:\.\d+(?:\.\d+)?)?$/;
const POSTGRES_VERIFIER_IMAGE_PATTERN =
  /^(?:(?:docker\.io\/)?library\/)?postgres:(?<version>(?<major>[1-9]\d*)(?:\.\d+(?:\.\d+)?)?(?:-[a-z0-9][a-z0-9._-]*)?)@sha256:[a-f0-9]{64}$/i;

export class BackupVerificationEligibilityError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "BackupVerificationEligibilityError";
  }
}

function assertBackupVerificationEligible(
  run: typeof backupRuns.$inferSelect,
  policy: { backupType: string; databaseEngine: string | null }
): void {
  if (
    policy.backupType !== "database" ||
    policy.databaseEngine !== "postgres" ||
    run.artifactFormat !== "postgres-custom"
  ) {
    throw new BackupVerificationEligibilityError(
      "Backup verification only supports PostgreSQL database backups in custom format. Create a new PostgreSQL custom-format backup before requesting verification."
    );
  }

  const checksum = run.checksum?.trim() ?? "";
  const sourceVersion = run.databaseEngineVersion?.trim() ?? "";
  const verifierImage = run.databaseImageReference?.trim() ?? "";
  const sourceMatch = POSTGRES_VERSION_PATTERN.exec(sourceVersion);
  const verifierMatch = POSTGRES_VERIFIER_IMAGE_PATTERN.exec(verifierImage);

  if (!/^[a-f0-9]{64}$/i.test(checksum) || !sourceMatch || !verifierMatch) {
    throw new BackupVerificationEligibilityError(
      "Backup verification requires a SHA-256 checksum, a source PostgreSQL version, and an immutable official PostgreSQL verifier image reference. Create a new backup with verification metadata before requesting verification."
    );
  }

  if (sourceMatch.groups?.major !== verifierMatch.groups?.major) {
    throw new BackupVerificationEligibilityError(
      "Backup verification requires the immutable verifier image to use the same PostgreSQL major version as the backup. Create a new backup with matching verification metadata before requesting verification."
    );
  }
}

type QueueBackupRestoreOptions = {
  testRestore?: boolean;
  teamId?: string;
  approvalRequestId?: string;
  operationId?: string;
  approvalDispatchId?: string;
  preserveDispatchRetry?: boolean;
  approvalSnapshot?: Record<string, unknown>;
};

function readApprovalSnapshotString(snapshot: Record<string, unknown> | undefined, key: string) {
  const value = snapshot?.[key];
  return typeof value === "string" ? value : "";
}

async function resolveRestoreApproval(
  backupRunId: string,
  expectedTeamId: string,
  approvalRequestId: string,
  snapshot: Record<string, unknown> | undefined
): Promise<RestoreApproval | null> {
  const approvalFilters = [
    eq(approvalRequests.teamId, expectedTeamId),
    eq(approvalRequests.actionType, "backup-restore"),
    eq(approvalRequests.targetResource, `backup-run/${backupRunId}`),
    eq(approvalRequests.status, "approved")
  ];

  const [approval] = await db
    .select({ id: approvalRequests.id })
    .from(approvalRequests)
    .where(and(eq(approvalRequests.id, approvalRequestId), ...approvalFilters))
    .limit(1);

  if (!approval) return null;

  const approvedSnapshot = {
    backupRunId: readApprovalSnapshotString(snapshot, "backupRunId"),
    artifactPath: readApprovalSnapshotString(snapshot, "artifactPath"),
    artifactChecksum: readApprovalSnapshotString(snapshot, "artifactChecksum"),
    backupPolicyId: readApprovalSnapshotString(snapshot, "backupPolicyId"),
    backupPolicyUpdatedAt: readApprovalSnapshotString(snapshot, "backupPolicyUpdatedAt"),
    backupDestinationId: readApprovalSnapshotString(snapshot, "backupDestinationId"),
    backupDestinationUpdatedAt: readApprovalSnapshotString(snapshot, "backupDestinationUpdatedAt"),
    volumeId: readApprovalSnapshotString(snapshot, "volumeId"),
    volumeUpdatedAt: readApprovalSnapshotString(snapshot, "volumeUpdatedAt"),
    volumeMountPath: readApprovalSnapshotString(snapshot, "volumeMountPath"),
    targetServerId: readApprovalSnapshotString(snapshot, "targetServerId"),
    restoreDestination: readApprovalSnapshotString(snapshot, "restoreDestination"),
    secretPolicy: readApprovalSnapshotString(snapshot, "secretPolicy")
  };
  if (
    Object.values(approvedSnapshot).some((value) => value.length === 0) ||
    approvedSnapshot.secretPolicy !== "destination-credentials-encrypted"
  ) {
    return null;
  }

  return {
    approvalRequestId: approval.id,
    expectedTeamId,
    snapshot: approvedSnapshot as RestoreApprovalSnapshot
  };
}

export async function buildBackupRestorePlan(backupRunId: string) {
  const run = await getBackupRunDetails(backupRunId);

  if (!run || run.status !== "succeeded" || !run.artifactPath || !run.mountPath) {
    return null;
  }

  const restoreTarget = `${run.mountPath} on ${run.destinationServerName || "the target server"}`;
  const restoreAction =
    run.backupType === "database"
      ? `Replay the ${run.databaseEngine ?? "database"} backup into ${restoreTarget}.`
      : `Replay the backup artifact into ${restoreTarget}.`;

  return {
    isReady: true,
    backupRun: {
      id: run.id,
      policyId: run.policyId,
      policyName: run.policyName,
      projectName: run.projectName,
      environmentName: run.environmentName,
      serviceName: run.serviceName,
      artifactPath: run.artifactPath,
      checksum: run.checksum,
      verifiedAt: run.verifiedAt,
      restoreCount: run.restoreCount
    },
    target: {
      destinationServerName: run.destinationServerName,
      path: run.mountPath,
      backupType: run.backupType,
      databaseEngine: run.databaseEngine
    },
    preflightChecks: [
      {
        status: "ok" as const,
        detail: `Resolved backup artifact ${run.artifactPath}.`
      },
      run.verifiedAt
        ? {
            status: "ok" as const,
            detail: `This backup was last verified at ${run.verifiedAt}.`
          }
        : {
            status: "warn" as const,
            detail: "This backup has not been verified by a test restore yet."
          },
      run.restoreCount > 0
        ? {
            status: "ok" as const,
            detail: `This backup already has ${run.restoreCount} recorded restore attempt(s).`
          }
        : {
            status: "warn" as const,
            detail: "No restore attempts have been recorded for this backup yet."
          },
      {
        status: "ok" as const,
        detail: `Restore target resolves to ${restoreTarget}.`
      }
    ],
    steps: [
      `Resolve the backup artifact from ${run.artifactPath}.`,
      restoreAction,
      "Queue the restore execution and persist the audit trail."
    ],
    executeCommand: `daoflow backup restore --backup-run-id ${backupRunId} --yes`,
    approvalRequest: {
      procedure: "requestApproval" as const,
      requiredScope: "approvals:create" as const,
      input: {
        actionType: "backup-restore" as const,
        backupRunId,
        reason: "Describe why replaying this backup is safe and necessary."
      }
    }
  };
}

export async function queueBackupRestore(
  backupRunId: string,
  userId: string,
  email: string,
  role: AppRole,
  opts?: QueueBackupRestoreOptions
) {
  const verification = opts?.testRestore === true;

  if (!verification && !isTemporalEnabled()) {
    throw new Error(
      "Backup restore execution requires Temporal mode. Set DAOFLOW_ENABLE_TEMPORAL=true and ensure TEMPORAL_ADDRESS is configured."
    );
  }

  const [run] = await db.select().from(backupRuns).where(eq(backupRuns.id, backupRunId)).limit(1);
  if (!run || run.status !== "succeeded" || !run.artifactPath) return null;
  const expectedBackupRunId = readApprovalSnapshotString(opts?.approvalSnapshot, "backupRunId");
  const expectedArtifactPath = readApprovalSnapshotString(opts?.approvalSnapshot, "artifactPath");
  const expectedChecksum = readApprovalSnapshotString(opts?.approvalSnapshot, "artifactChecksum");
  if (
    (expectedBackupRunId && expectedBackupRunId !== run.id) ||
    (expectedArtifactPath && expectedArtifactPath !== run.artifactPath) ||
    (expectedChecksum && expectedChecksum !== (run.checksum ?? ""))
  ) {
    return null;
  }

  const relations = await loadBackupRelations();
  const policy = relations.policiesById.get(run.policyId);
  if (!policy) return null;
  const expectedPolicyId = readApprovalSnapshotString(opts?.approvalSnapshot, "backupPolicyId");
  const expectedPolicyUpdatedAt = readApprovalSnapshotString(
    opts?.approvalSnapshot,
    "backupPolicyUpdatedAt"
  );
  const expectedDestinationId = readApprovalSnapshotString(
    opts?.approvalSnapshot,
    "backupDestinationId"
  );
  const expectedDestinationUpdatedAt = readApprovalSnapshotString(
    opts?.approvalSnapshot,
    "backupDestinationUpdatedAt"
  );
  const destination = policy.destinationId
    ? relations.destinationsById.get(policy.destinationId)
    : null;
  if (
    (expectedPolicyId && expectedPolicyId !== policy.id) ||
    (expectedPolicyUpdatedAt && expectedPolicyUpdatedAt !== policy.updatedAt.toISOString()) ||
    (expectedDestinationId && expectedDestinationId !== (policy.destinationId ?? "")) ||
    (expectedDestinationId && !destination) ||
    (expectedDestinationUpdatedAt &&
      expectedDestinationUpdatedAt !== destination?.updatedAt.toISOString())
  ) {
    return null;
  }
  if (verification) {
    assertBackupVerificationEligible(run, policy);
  }
  const volume = relations.volumesById.get(policy.volumeId);
  if (!volume) return null;
  const expectedVolumeId = readApprovalSnapshotString(opts?.approvalSnapshot, "volumeId");
  const expectedVolumeUpdatedAt = readApprovalSnapshotString(
    opts?.approvalSnapshot,
    "volumeUpdatedAt"
  );
  const expectedMountPath = readApprovalSnapshotString(opts?.approvalSnapshot, "volumeMountPath");
  const expectedRestoreDestination = readApprovalSnapshotString(
    opts?.approvalSnapshot,
    "restoreDestination"
  );
  const expectedServerId = readApprovalSnapshotString(opts?.approvalSnapshot, "targetServerId");
  if (
    (expectedVolumeId && expectedVolumeId !== volume.id) ||
    (expectedVolumeUpdatedAt && expectedVolumeUpdatedAt !== volume.updatedAt.toISOString()) ||
    (expectedMountPath && expectedMountPath !== volume.mountPath) ||
    (expectedRestoreDestination && expectedRestoreDestination !== volume.mountPath) ||
    (expectedServerId && expectedServerId !== volume.serverId)
  ) {
    return null;
  }
  const volumeTeamId = await resolveVolumeTeamId(volume);
  if (!volumeTeamId) return null;
  if (opts?.teamId && volumeTeamId !== opts.teamId) return null;
  const approval =
    opts?.teamId && opts.approvalRequestId
      ? ((await resolveRestoreApproval(
          backupRunId,
          opts.teamId,
          opts.approvalRequestId,
          opts.approvalSnapshot
        )) ?? undefined)
      : undefined;
  if (opts?.teamId && !approval) return null;
  if (!isTemporalEnabled()) {
    throw new Error(
      "Backup restore execution requires Temporal mode. Set DAOFLOW_ENABLE_TEMPORAL=true and ensure TEMPORAL_ADDRESS is configured."
    );
  }
  const server = relations.serversById.get(volume.serverId);
  const view = getPolicyView(policy, volume);
  const restoreId = opts?.operationId ?? id();
  const now = new Date();
  const mode = opts?.testRestore ? ("verification" as const) : ("restore" as const);

  const restore = await db.transaction(async (tx) => {
    const [createdRestore] = await tx
      .insert(backupRestores)
      .values({
        id: restoreId,
        backupRunId,
        mode,
        status: "queued",
        targetPath: mode === "restore" ? volume.mountPath : null,
        triggeredByUserId: userId,
        startedAt: now,
        createdAt: now
      })
      .onConflictDoNothing()
      .returning();
    const persisted =
      createdRestore ??
      (await tx.select().from(backupRestores).where(eq(backupRestores.id, restoreId)).limit(1))[0];
    if (!persisted) return null;
    if (persisted.backupRunId !== backupRunId || persisted.mode !== mode) {
      throw new Error(`Backup restore operation ${restoreId} is already bound to another input.`);
    }

    const [existingAudit] = await tx
      .select({ id: auditEntries.id })
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.targetResource, `backup-restore/${restoreId}`),
          eq(
            auditEntries.action,
            mode === "verification" ? "backup.verify.queue" : "backup.restore.queue"
          )
        )
      )
      .limit(1);
    if (!existingAudit) {
      await tx.insert(auditEntries).values({
        actorType: "user",
        actorId: userId,
        actorEmail: email,
        actorRole: role,
        targetResource: `backup-restore/${restoreId}`,
        action: mode === "verification" ? "backup.verify.queue" : "backup.restore.queue",
        inputSummary: `Queued ${mode === "verification" ? "verification" : "restore"} for ${view.serviceName}@${view.environmentName}.`,
        permissionScope: "backup:restore",
        outcome: "success",
        metadata: {
          teamId: volumeTeamId,
          resourceType: "backup-restore",
          resourceId: restoreId,
          resourceLabel: `${view.serviceName}@${view.environmentName}`,
          ...(opts?.approvalRequestId ? { approvalRequestId: opts.approvalRequestId } : {}),
          ...(opts?.approvalDispatchId ? { approvalDispatchId: opts.approvalDispatchId } : {}),
          operationId: restoreId,
          detail: `Queued ${mode === "verification" ? "verification" : "restore"} for ${view.serviceName}@${view.environmentName} on ${server?.name ?? volume.serverId}.`
        }
      });
    }
    return persisted;
  });
  if (!restore) {
    throw new Error("Backup restore operation could not be persisted.");
  }

  try {
    const workflow = await startRestoreWorkflow({
      restoreId,
      backupRunId,
      triggeredBy: userId,
      targetPath: mode === "restore" ? volume.mountPath : null,
      mode,
      testRestore: opts?.testRestore,
      approval
    });

    return {
      ...restore,
      workflowId: workflow.workflowId
    };
  } catch (error) {
    if (opts?.preserveDispatchRetry) {
      throw error;
    }

    await db
      .update(backupRestores)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date()
      })
      .where(eq(backupRestores.id, restoreId));

    throw error;
  }
}
