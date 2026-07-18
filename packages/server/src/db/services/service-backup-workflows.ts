import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../connection";
import { backupDestinations } from "../schema/destinations";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
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

export async function serviceBelongsToTeam(serviceId: string, teamId: string) {
  const [row] = await db
    .select({ service: services, environment: environments, project: projects })
    .from(services)
    .innerJoin(environments, eq(environments.id, services.environmentId))
    .innerJoin(projects, eq(projects.id, services.projectId))
    .where(eq(services.id, serviceId))
    .limit(1);

  if (!row || row.project.teamId !== teamId) {
    return null;
  }

  return row;
}

function isServiceVolume(volume: typeof volumes.$inferSelect, serviceId: string) {
  return readString(asRecord(volume.metadata), "serviceId") === serviceId;
}

export async function listServiceBackupWorkflowForTeam(input: {
  serviceId: string;
  teamId: string;
  limit?: number;
}) {
  const service = await serviceBelongsToTeam(input.serviceId, input.teamId);
  if (!service) {
    return null;
  }

  const limit = input.limit ?? 12;
  const [volumeRows, policyRows, destinationRows, serverRows, userRows] = await Promise.all([
    db.select().from(volumes),
    db.select().from(backupPolicies),
    db.select().from(backupDestinations).where(eq(backupDestinations.teamId, input.teamId)),
    db.select().from(servers),
    db.select().from(users)
  ]);

  const serviceVolumes = volumeRows.filter((volume) => isServiceVolume(volume, input.serviceId));
  const volumeIds = new Set(serviceVolumes.map((volume) => volume.id));
  const servicePolicies = policyRows.filter((policy) => volumeIds.has(policy.volumeId));
  const policyIds = servicePolicies.map((policy) => policy.id);
  const runRows =
    policyIds.length > 0
      ? await db
          .select()
          .from(backupRuns)
          .where(inArray(backupRuns.policyId, policyIds))
          .orderBy(desc(backupRuns.createdAt))
          .limit(limit)
      : [];
  const runIds = runRows.map((run) => run.id);
  const restoreRows =
    runIds.length > 0
      ? await db
          .select()
          .from(backupRestores)
          .where(inArray(backupRestores.backupRunId, runIds))
          .orderBy(desc(backupRestores.createdAt))
          .limit(limit)
      : [];

  const policiesById = new Map(servicePolicies.map((policy) => [policy.id, policy]));
  const policyByVolumeId = new Map(servicePolicies.map((policy) => [policy.volumeId, policy]));
  const volumesById = new Map(serviceVolumes.map((volume) => [volume.id, volume]));
  const destinationsById = new Map(
    destinationRows.map((destination) => [destination.id, destination])
  );
  const serversById = new Map(serverRows.map((server) => [server.id, server]));
  const usersById = new Map(userRows.map((user) => [user.id, user]));
  const latestRunByPolicyId = new Map<string, typeof backupRuns.$inferSelect>();

  for (const run of runRows) {
    if (!latestRunByPolicyId.has(run.policyId)) {
      latestRunByPolicyId.set(run.policyId, run);
    }
  }

  const volumeViews = serviceVolumes.map((volume) => {
    const metadata = asRecord(volume.metadata);
    const backupPolicyId = readString(metadata, "backupPolicyId") || null;
    const policy = backupPolicyId
      ? policiesById.get(backupPolicyId)
      : policyByVolumeId.get(volume.id);
    const destination = policy?.destinationId ? destinationsById.get(policy.destinationId) : null;
    const backupCoverage = readString(
      metadata,
      "backupCoverage",
      backupPolicyId ? "protected" : "missing"
    );
    const restoreReadiness = readString(metadata, "restoreReadiness", "untested");
    const server = serversById.get(volume.serverId);
    const latestRun = latestRunByPolicyId.get(policy?.id ?? "");

    return {
      id: volume.id,
      serverId: volume.serverId,
      serverName: readString(metadata, "targetServerName", server?.name ?? volume.serverId),
      volumeName: volume.name,
      mountPath: volume.mountPath,
      driver: readString(metadata, "driver", "local"),
      sizeBytes: Number(volume.sizeBytes ?? 0),
      status: volume.status,
      backupPolicyId: policy?.id ?? null,
      storageProvider: destination?.provider ?? destination?.name ?? null,
      lastBackupAt:
        readString(metadata, "lastBackupAt") || latestRun?.completedAt?.toISOString() || null,
      lastRestoreTestAt: readString(metadata, "lastRestoreTestAt") || null,
      backupCoverage,
      restoreReadiness,
      statusTone: getPersistentVolumeStatusTone(backupCoverage, restoreReadiness),
      createdAt: volume.createdAt.toISOString(),
      updatedAt: volume.updatedAt.toISOString()
    };
  });

  return {
    service: {
      id: service.service.id,
      name: service.service.name,
      projectName: service.project.name,
      environmentName: service.environment.name
    },
    summary: {
      totalVolumes: serviceVolumes.length,
      protectedVolumes: volumeViews.filter((volume) => volume.backupCoverage === "protected")
        .length,
      totalPolicies: servicePolicies.length,
      succeededRuns: runRows.filter((run) => run.status === "succeeded").length,
      failedRuns: runRows.filter((run) => run.status === "failed").length,
      restoreRequests: restoreRows.length
    },
    volumes: volumeViews,
    policies: servicePolicies.map((policy) => {
      const volume = volumesById.get(policy.volumeId);
      const destination = policy.destinationId ? destinationsById.get(policy.destinationId) : null;
      const view = getPolicyView(policy, volume, destination);
      const workflowId = readBackupPolicyWorkflowId(policy);
      const latestRun = latestRunByPolicyId.get(policy.id);

      return {
        id: policy.id,
        name: policy.name,
        volumeId: policy.volumeId,
        destinationId: policy.destinationId,
        destinationName: destination?.name ?? null,
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
        temporalWorkflowStatus: null as string | null
      };
    }),
    runs: runRows.map((run) => {
      const policy = policiesById.get(run.policyId);
      const volume = policy ? volumesById.get(policy.volumeId) : undefined;
      const view = policy ? getPolicyView(policy, volume) : null;
      const workflowId = readBackupRunWorkflowId(run, policy);

      return {
        id: run.id,
        policyId: run.policyId,
        projectName: view?.projectName ?? service.project.name,
        environmentName: view?.environmentName ?? service.environment.name,
        serviceName: view?.serviceName ?? service.service.name,
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
    }),
    restores: restoreRows.map((restore) => {
      const run = runRows.find((candidate) => candidate.id === restore.backupRunId);
      const policy = run ? policiesById.get(run.policyId) : undefined;
      const volume = policy ? volumesById.get(policy.volumeId) : undefined;
      const server = volume ? serversById.get(volume.serverId) : undefined;

      return {
        id: restore.id,
        backupRunId: restore.backupRunId,
        mode: restore.mode,
        policyId: policy?.id ?? "",
        volumeName: volume?.name ?? "",
        destinationServerName: server?.name ?? volume?.serverId ?? "",
        sourceArtifactPath: run?.artifactPath ?? null,
        targetPath: restore.targetPath,
        verificationResult: restore.verificationResult,
        requestedBy: readRequestedByEmail(restore.triggeredByUserId, usersById),
        status: restore.status,
        statusTone: getBackupOperationStatusTone(restore.status),
        error: restore.error,
        requestedAt: restore.createdAt.toISOString(),
        finishedAt: restore.completedAt?.toISOString() ?? null
      };
    })
  };
}
