import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../connection";
import { backupDestinations } from "../schema/destinations";
import { projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { backupPolicies, backupRestores, backupRuns, volumes } from "../schema/storage";
import { users } from "../schema/users";
import { asRecord, readString } from "./json-helpers";
import {
  getBackupOperationStatusTone,
  getPersistentVolumeStatusTone,
  getPolicyView,
  readBackupExecutionEngine,
  readBackupPolicyWorkflowId,
  readBackupRunWorkflowId,
  readRequestedByEmail
} from "./backup-view-helpers";

async function projectIdsForTeam(teamId: string) {
  const rows = await db
    .select({ id: projects.id })
    .from(projects)
    .where(eq(projects.teamId, teamId));
  return new Set(rows.map((row) => row.id));
}

function volumeBelongsToTeam(
  volume: typeof volumes.$inferSelect,
  allowedProjectIds: Set<string>,
  allowedServerIds: Set<string>
) {
  if (!allowedServerIds.has(volume.serverId)) return false;
  const projectId = readString(asRecord(volume.metadata), "projectId");
  return !projectId || allowedProjectIds.has(projectId);
}

async function loadScopedBackupRows(teamId: string) {
  const allowedProjectIds = await projectIdsForTeam(teamId);
  const [volumeRows, policyRows, destinationRows, serverRows] = await Promise.all([
    db.select().from(volumes),
    db.select().from(backupPolicies),
    db.select().from(backupDestinations).where(eq(backupDestinations.teamId, teamId)),
    db.select().from(servers).where(eq(servers.teamId, teamId))
  ]);
  const allowedServerIds = new Set(serverRows.map((server) => server.id));
  const scopedVolumes = volumeRows.filter((volume) =>
    volumeBelongsToTeam(volume, allowedProjectIds, allowedServerIds)
  );
  const scopedVolumeIds = new Set(scopedVolumes.map((volume) => volume.id));
  const scopedPolicies = policyRows.filter((policy) => scopedVolumeIds.has(policy.volumeId));
  const scopedPolicyIds = new Set(scopedPolicies.map((policy) => policy.id));

  return {
    volumesById: new Map(scopedVolumes.map((volume) => [volume.id, volume])),
    policiesById: new Map(scopedPolicies.map((policy) => [policy.id, policy])),
    destinationsById: new Map(destinationRows.map((destination) => [destination.id, destination])),
    serversById: new Map(serverRows.map((server) => [server.id, server])),
    scopedPolicies,
    scopedPolicyIds,
    scopedVolumes
  };
}

export async function listBackupOverviewForTeam(teamId: string, limit = 12) {
  const relations = await loadScopedBackupRows(teamId);
  const scopedPolicyIds = [...relations.scopedPolicyIds];
  const [runs, triggeredByUsers] = await Promise.all([
    scopedPolicyIds.length > 0
      ? db
          .select()
          .from(backupRuns)
          .where(inArray(backupRuns.policyId, scopedPolicyIds))
          .orderBy(desc(backupRuns.createdAt))
          .limit(limit)
      : [],
    db.select().from(users)
  ]);
  const usersById = new Map(triggeredByUsers.map((user) => [user.id, user]));
  const latestRunByPolicyId = new Map<string, typeof backupRuns.$inferSelect>();
  for (const run of runs) {
    if (!latestRunByPolicyId.has(run.policyId)) {
      latestRunByPolicyId.set(run.policyId, run);
    }
  }

  return {
    summary: {
      totalPolicies: relations.scopedPolicies.length,
      queuedRuns: runs.filter((run) => run.status === "queued").length,
      runningRuns: runs.filter((run) => run.status === "running").length,
      succeededRuns: runs.filter((run) => run.status === "succeeded").length,
      failedRuns: runs.filter((run) => run.status === "failed").length
    },
    policies: relations.scopedPolicies.map((policy) => {
      const volume = relations.volumesById.get(policy.volumeId);
      const destination = policy.destinationId
        ? relations.destinationsById.get(policy.destinationId)
        : null;
      const view = getPolicyView(policy, volume, destination);
      const latestRun = latestRunByPolicyId.get(policy.id);
      const workflowId = readBackupPolicyWorkflowId(policy);
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
        temporalWorkflowStatus: null
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

export async function listBackupRestoreQueueForTeam(teamId: string, limit = 12) {
  const relations = await loadScopedBackupRows(teamId);
  const scopedPolicyIds = [...relations.scopedPolicyIds];
  const runRows =
    scopedPolicyIds.length > 0
      ? await db.select().from(backupRuns).where(inArray(backupRuns.policyId, scopedPolicyIds))
      : [];
  const runIds = runRows.map((run) => run.id);
  const restores =
    runIds.length > 0
      ? await db
          .select()
          .from(backupRestores)
          .where(inArray(backupRestores.backupRunId, runIds))
          .orderBy(desc(backupRestores.createdAt))
          .limit(limit)
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
        mode: restore.mode,
        policyId: policy?.id ?? "",
        projectName: view?.projectName ?? "",
        environmentName: view?.environmentName ?? "",
        serviceName: view?.serviceName ?? "",
        targetType: view?.targetType ?? ("volume" as const),
        requestedBy: readRequestedByEmail(restore.triggeredByUserId, usersById),
        destinationServerName: server?.name ?? volume?.serverId ?? "",
        sourceArtifactPath: run?.artifactPath ?? null,
        restorePath: restore.targetPath,
        verificationResult: restore.verificationResult,
        validationSummary: restore.error ?? "",
        status: restore.status,
        statusTone: getBackupOperationStatusTone(restore.status),
        requestedAt: restore.createdAt.toISOString(),
        finishedAt: restore.completedAt?.toISOString() ?? null
      };
    })
  };
}

export async function listPersistentVolumeInventoryForTeam(teamId: string, limit = 12) {
  const relations = await loadScopedBackupRows(teamId);
  const policyRows = [...relations.policiesById.values()];
  const policiesById = new Map(policyRows.map((policy) => [policy.id, policy]));
  const policyIds = new Set(policyRows.map((policy) => policy.id));
  const inventory = relations.scopedVolumes
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime())
    .slice(0, limit)
    .map((volume) => {
      const metadata = asRecord(volume.metadata);
      const backupPolicyId = readString(metadata, "backupPolicyId") || null;
      const backupCoverage = readString(
        metadata,
        "backupCoverage",
        backupPolicyId ? "protected" : "missing"
      );
      const restoreReadiness = readString(metadata, "restoreReadiness", "untested");
      const server = relations.serversById.get(volume.serverId);
      const policy = backupPolicyId ? policiesById.get(backupPolicyId) : null;
      const destination = policy?.destinationId
        ? relations.destinationsById.get(policy.destinationId)
        : null;

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
        storageProvider: destination?.provider ?? destination?.name ?? null,
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
