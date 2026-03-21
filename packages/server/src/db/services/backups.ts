import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { backupPolicies, backupRestores, backupRuns, volumes } from "../schema/storage";
import { backupDestinations } from "../schema/destinations";
import { servers } from "../schema/servers";
import { users } from "../schema/users";
import type { AppRole } from "@daoflow/shared";
import { newId as id, asRecord, readString } from "./json-helpers";
import {
  getBackupOperationStatusTone,
  getPersistentVolumeStatusTone,
  getPolicyView,
  loadBackupRelations,
  readBackupExecutionEngine,
  readBackupPolicyWorkflowId,
  readBackupRunWorkflowId,
  readRequestedByEmail
} from "./backup-view-helpers";
import { getBackupRunDetails } from "./backup-run-details";
import { getBackupCronStatus, startOneOffBackupWorkflow } from "../../worker";
import { isTemporalEnabled } from "../../worker/temporal/temporal-config";

export async function listBackupOverview(limit = 12) {
  const [policies, runs, relations, triggeredByUsers] = await Promise.all([
    db.select().from(backupPolicies).orderBy(desc(backupPolicies.createdAt)),
    db.select().from(backupRuns).orderBy(desc(backupRuns.createdAt)).limit(limit),
    loadBackupRelations(),
    db.select().from(users)
  ]);

  const usersById = new Map(triggeredByUsers.map((user) => [user.id, user]));
  const latestRunByPolicyId = new Map<string, typeof backupRuns.$inferSelect>();
  for (const run of runs) {
    if (!latestRunByPolicyId.has(run.policyId)) {
      latestRunByPolicyId.set(run.policyId, run);
    }
  }

  const temporalStatuses =
    isTemporalEnabled() && policies.some((policy) => readBackupPolicyWorkflowId(policy))
      ? await Promise.all(
          policies.map(async (policy) => [policy.id, await getBackupCronStatus(policy.id)] as const)
        )
      : [];
  const temporalStatusByPolicyId = new Map(temporalStatuses);

  return {
    summary: {
      totalPolicies: policies.length,
      queuedRuns: runs.filter((run) => run.status === "queued").length,
      runningRuns: runs.filter((run) => run.status === "running").length,
      succeededRuns: runs.filter((run) => run.status === "succeeded").length,
      failedRuns: runs.filter((run) => run.status === "failed").length
    },
    policies: policies.map((policy) => {
      const volume = relations.volumesById.get(policy.volumeId);
      const destination = policy.destinationId
        ? relations.destinationsById.get(policy.destinationId)
        : null;
      const view = getPolicyView(policy, volume, destination);
      const latestRun = latestRunByPolicyId.get(policy.id);
      const workflowId = readBackupPolicyWorkflowId(policy);
      const workflowStatus = temporalStatusByPolicyId.get(policy.id)?.status ?? null;
      return {
        id: policy.id,
        name: policy.name,
        volumeId: policy.volumeId,
        destinationId: policy.destinationId,
        projectName: view.projectName,
        environmentName: view.environmentName,
        serviceName: view.serviceName,
        targetType: view.targetType,
        storageProvider: view.storageProvider,
        backupType: policy.backupType,
        databaseEngine: policy.databaseEngine,
        turnOff: policy.turnOff === 1,
        scheduleLabel: policy.schedule,
        schedule: policy.schedule,
        retentionCount: policy.retentionDays,
        retentionDays: policy.retentionDays,
        retentionDaily: policy.retentionDaily,
        retentionWeekly: policy.retentionWeekly,
        retentionMonthly: policy.retentionMonthly,
        maxBackups: policy.maxBackups,
        status: policy.status,
        nextRunAt: null as string | null,
        lastRunAt: latestRun?.createdAt.toISOString() ?? null,
        executionEngine: readBackupExecutionEngine(workflowId),
        temporalWorkflowId: workflowId,
        temporalWorkflowStatus: workflowStatus
      };
    }),
    runs: runs.map((run) => {
      const policy = relations.policiesById.get(run.policyId);
      const volume = policy ? relations.volumesById.get(policy.volumeId) : undefined;
      const view = policy ? getPolicyView(policy, volume) : null;
      const workflowId = readBackupRunWorkflowId(run, policy);
      return {
        id: run.id,
        policyId: run.policyId,
        projectName: view?.projectName ?? "",
        environmentName: view?.environmentName ?? "",
        serviceName: view?.serviceName ?? "",
        targetType: view?.targetType ?? ("volume" as const),
        status: run.status,
        statusTone: getBackupOperationStatusTone(run.status),
        triggerKind: run.triggeredByUserId ? ("manual" as const) : ("scheduled" as const),
        requestedBy: readRequestedByEmail(run.triggeredByUserId, usersById),
        artifactPath: run.artifactPath,
        bytesWritten: run.sizeBytes ? Number(run.sizeBytes) : null,
        startedAt: run.startedAt?.toISOString() ?? run.createdAt.toISOString(),
        finishedAt: run.completedAt?.toISOString() ?? null,
        executionEngine: readBackupExecutionEngine(workflowId),
        temporalWorkflowId: workflowId
      };
    })
  };
}

export async function triggerBackupRun(
  policyId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  if (!isTemporalEnabled()) {
    throw new Error(
      "Manual backup execution requires Temporal mode. Set DAOFLOW_ENABLE_TEMPORAL=true and ensure TEMPORAL_ADDRESS is configured."
    );
  }

  const policy = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, policyId))
    .limit(1);
  if (!policy[0]) return null;

  const relations = await loadBackupRelations();
  const volume = relations.volumesById.get(policy[0].volumeId);
  const view = getPolicyView(policy[0], volume);
  const runId = id();
  const now = new Date();

  const [run] = await db
    .insert(backupRuns)
    .values({
      id: runId,
      policyId,
      status: "queued",
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
    targetResource: `backup-run/${runId}`,
    action: "backup.trigger",
    inputSummary: `Queued backup for ${view.serviceName}@${view.environmentName}.`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-run",
      resourceId: runId,
      resourceLabel: `${view.serviceName}@${view.environmentName}`,
      detail: `Queued backup for ${view.serviceName}@${view.environmentName}.`
    }
  });

  try {
    const workflow = await startOneOffBackupWorkflow(policyId, userId, runId);
    return {
      ...run,
      workflowId: workflow.workflowId
    };
  } catch (error) {
    await db
      .update(backupRuns)
      .set({
        status: "failed",
        error: error instanceof Error ? error.message : String(error),
        completedAt: new Date()
      })
      .where(eq(backupRuns.id, runId));

    throw error;
  }
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
  _opts?: { testRestore?: boolean }
) {
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

  return restore;
}

export async function listBackupRestoreQueue(limit = 12) {
  const restores = await db
    .select()
    .from(backupRestores)
    .orderBy(desc(backupRestores.createdAt))
    .limit(limit);

  const backupRunIds = [...new Set(restores.map((restore) => restore.backupRunId))];
  const runRows =
    backupRunIds.length > 0
      ? await db.select().from(backupRuns).where(inArray(backupRuns.id, backupRunIds))
      : [];
  const userIds = [
    ...new Set(
      restores
        .map((restore) => restore.triggeredByUserId)
        .filter((userId): userId is string => typeof userId === "string")
    )
  ];
  const userRows =
    userIds.length > 0 ? await db.select().from(users).where(inArray(users.id, userIds)) : [];

  const relations = await loadBackupRelations();
  const runsById = new Map(runRows.map((run) => [run.id, run]));
  const usersById = new Map(userRows.map((user) => [user.id, user]));

  return {
    summary: {
      totalRequests: restores.length,
      queuedRequests: restores.filter((restore) => restore.status === "queued").length,
      runningRequests: restores.filter((restore) => restore.status === "running").length,
      succeededRequests: restores.filter((restore) => restore.status === "succeeded").length,
      failedRequests: restores.filter((restore) => restore.status === "failed").length
    },
    requests: restores.map((restore) => {
      const run = runsById.get(restore.backupRunId);
      const policy = run ? relations.policiesById.get(run.policyId) : undefined;
      const volume = policy ? relations.volumesById.get(policy.volumeId) : undefined;
      const server = volume ? relations.serversById.get(volume.serverId) : undefined;
      const view = policy ? getPolicyView(policy, volume) : undefined;

      return {
        id: restore.id,
        policyId: policy?.id ?? "",
        projectName: view?.projectName ?? "",
        environmentName: view?.environmentName ?? "",
        serviceName: view?.serviceName ?? "",
        targetType: view?.targetType ?? ("volume" as const),
        requestedBy: readRequestedByEmail(restore.triggeredByUserId, usersById),
        destinationServerName: server?.name ?? volume?.serverId ?? "",
        sourceArtifactPath: run?.artifactPath ?? null,
        restorePath: restore.targetPath,
        validationSummary: restore.error ?? "",
        status: restore.status,
        statusTone: getBackupOperationStatusTone(restore.status),
        requestedAt: restore.createdAt.toISOString(),
        finishedAt: restore.completedAt?.toISOString() ?? null
      };
    })
  };
}

export async function listPersistentVolumeInventory(limit = 12) {
  const [volumeRows, policyRows, serverRows, destinationRows] = await Promise.all([
    db.select().from(volumes).orderBy(desc(volumes.createdAt)).limit(limit),
    db.select().from(backupPolicies),
    db.select().from(servers),
    db.select().from(backupDestinations)
  ]);

  const policiesById = new Map(policyRows.map((policy) => [policy.id, policy]));
  const policyIds = new Set(policyRows.map((policy) => policy.id));
  const serversById = new Map(serverRows.map((server) => [server.id, server]));
  const destinationsById = new Map(destinationRows.map((d) => [d.id, d]));

  const inventory = volumeRows.map((volume) => {
    const metadata = asRecord(volume.metadata);
    const backupPolicyId = readString(metadata, "backupPolicyId") || null;
    const backupCoverage = readString(
      metadata,
      "backupCoverage",
      backupPolicyId ? "protected" : "missing"
    );
    const restoreReadiness = readString(metadata, "restoreReadiness", "untested");
    const server = serversById.get(volume.serverId);

    // Resolve storage provider from destination FK
    let storageProvider: string | null = null;
    if (backupPolicyId && policyIds.has(backupPolicyId)) {
      const policy = policiesById.get(backupPolicyId);
      const dest = policy?.destinationId ? destinationsById.get(policy.destinationId) : null;
      storageProvider = dest?.provider ?? dest?.name ?? "(none)";
    }

    return {
      id: volume.id,
      serverId: volume.serverId,
      environmentId: readString(metadata, "environmentId"),
      environmentName: readString(metadata, "environmentName"),
      projectId: readString(metadata, "projectId"),
      projectName: readString(metadata, "projectName"),
      serviceId: readString(metadata, "serviceId") || null,
      targetServerName: readString(metadata, "targetServerName", server?.name ?? volume.serverId),
      serviceName: readString(metadata, "serviceName"),
      volumeName: volume.name,
      mountPath: volume.mountPath,
      driver: readString(metadata, "driver", "local"),
      sizeBytes: Number(volume.sizeBytes ?? 0),
      status: volume.status,
      backupPolicyId: backupPolicyId && policyIds.has(backupPolicyId) ? backupPolicyId : null,
      storageProvider,
      lastBackupAt: readString(metadata, "lastBackupAt") || null,
      lastRestoreTestAt: readString(metadata, "lastRestoreTestAt") || null,
      backupCoverage,
      restoreReadiness,
      statusTone: getPersistentVolumeStatusTone(backupCoverage, restoreReadiness),
      createdAt: volume.createdAt.toISOString(),
      updatedAt: volume.updatedAt.toISOString()
    };
  });

  return {
    summary: {
      totalVolumes: inventory.length,
      protectedVolumes: inventory.filter((volume) => volume.backupCoverage === "protected").length,
      attentionVolumes: inventory.filter(
        (volume) => volume.backupCoverage !== "protected" || volume.restoreReadiness !== "verified"
      ).length,
      attachedBytes: inventory.reduce((sum, volume) => sum + volume.sizeBytes, 0)
    },
    volumes: inventory
  };
}

// Re-export schedule management, metrics, and diagnosis from backup-schedules.ts
export {
  enableBackupSchedule,
  disableBackupSchedule,
  triggerBackupNow,
  getScheduleStatus,
  listBackupMetrics,
  backupDiagnosis
} from "./backup-schedules";
