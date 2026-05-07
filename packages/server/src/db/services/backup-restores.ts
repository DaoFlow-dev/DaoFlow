import { eq } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { backupRestores, backupRuns } from "../schema/storage";
import { startRestoreWorkflow } from "../../worker";
import { isTemporalEnabled } from "../../worker/temporal/temporal-config";
import { getBackupRunDetails } from "./backup-run-details";
import { getPolicyView, loadBackupRelations } from "./backup-view-helpers";
import { newId as id } from "./json-helpers";

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
  opts?: { testRestore?: boolean }
) {
  if (!isTemporalEnabled()) {
    throw new Error(
      "Backup restore execution requires Temporal mode. Set DAOFLOW_ENABLE_TEMPORAL=true and ensure TEMPORAL_ADDRESS is configured."
    );
  }

  const [run] = await db.select().from(backupRuns).where(eq(backupRuns.id, backupRunId)).limit(1);
  if (!run || run.status !== "succeeded" || !run.artifactPath) return null;

  const relations = await loadBackupRelations();
  const policy = relations.policiesById.get(run.policyId);
  if (!policy) return null;
  const volume = relations.volumesById.get(policy.volumeId);
  if (!volume) return null;
  const server = relations.serversById.get(volume.serverId);
  const view = getPolicyView(policy, volume);
  const restoreId = id();
  const now = new Date();

  const [restore] = await db
    .insert(backupRestores)
    .values({
      id: restoreId,
      backupRunId,
      status: "queued",
      targetPath: volume.mountPath,
      triggeredByUserId: userId,
      startedAt: now,
      createdAt: now
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `backup-restore/${restoreId}`,
    action: "backup.restore.queue",
    inputSummary: `Queued restore for ${view.serviceName}@${view.environmentName}.`,
    permissionScope: "backup:restore",
    outcome: "success",
    metadata: {
      resourceType: "backup-restore",
      resourceId: restoreId,
      resourceLabel: `${view.serviceName}@${view.environmentName}`,
      detail: `Queued restore for ${view.serviceName}@${view.environmentName} on ${server?.name ?? volume.serverId}.`
    }
  });

  try {
    const workflow = await startRestoreWorkflow({
      restoreId,
      backupRunId,
      triggeredBy: userId,
      targetPath: volume.mountPath,
      testRestore: opts?.testRestore
    });

    return {
      ...restore,
      workflowId: workflow.workflowId
    };
  } catch (error) {
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
