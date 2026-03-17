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
  startBackupCronWorkflow,
  cancelBackupCronWorkflow,
  startOneOffBackupWorkflow,
  getBackupCronStatus
} from "../../worker";

const SEEDED_POLICY_VIEW: Record<
  string,
  {
    projectName: string;
    environmentName: string;
    serviceName: string;
    targetType: "volume" | "database";
  }
> = {
  bpol_foundation_volume_daily: {
    projectName: "DaoFlow",
    environmentName: "production-us-west",
    serviceName: "postgres-volume",
    targetType: "volume"
  },
  bpol_foundation_db_hourly: {
    projectName: "DaoFlow",
    environmentName: "staging",
    serviceName: "control-plane-db",
    targetType: "database"
  }
};

function getPolicyView(
  policy: typeof backupPolicies.$inferSelect,
  volume?: typeof volumes.$inferSelect,
  destination?: typeof backupDestinations.$inferSelect | null
) {
  const seeded = SEEDED_POLICY_VIEW[policy.id];
  const metadata = asRecord(volume?.metadata);

  return {
    projectName: seeded?.projectName ?? readString(metadata, "projectName"),
    environmentName: seeded?.environmentName ?? readString(metadata, "environmentName"),
    serviceName: seeded?.serviceName ?? policy.name,
    targetType: seeded?.targetType ?? ("volume" as const),
    storageProvider: destination?.provider ?? destination?.name ?? "(none)"
  };
}

async function loadBackupRelations() {
  const [policyRows, volumeRows, serverRows, destinationRows] = await Promise.all([
    db.select().from(backupPolicies),
    db.select().from(volumes),
    db.select().from(servers),
    db.select().from(backupDestinations)
  ]);

  return {
    policiesById: new Map(policyRows.map((row) => [row.id, row])),
    volumesById: new Map(volumeRows.map((row) => [row.id, row])),
    serversById: new Map(serverRows.map((row) => [row.id, row])),
    destinationsById: new Map(destinationRows.map((row) => [row.id, row]))
  };
}

export async function listBackupOverview(limit = 12) {
  const [policies, runs, relations, triggeredByUsers] = await Promise.all([
    db.select().from(backupPolicies).orderBy(desc(backupPolicies.createdAt)),
    db.select().from(backupRuns).orderBy(desc(backupRuns.createdAt)).limit(limit),
    loadBackupRelations(),
    db.select().from(users)
  ]);

  const usersById = new Map(triggeredByUsers.map((user) => [user.id, user]));

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
      return {
        id: policy.id,
        projectName: view.projectName,
        environmentName: view.environmentName,
        serviceName: view.serviceName,
        targetType: view.targetType,
        storageProvider: view.storageProvider,
        scheduleLabel: policy.schedule,
        retentionCount: policy.retentionDays,
        nextRunAt: null as string | null,
        lastRunAt: null as string | null
      };
    }),
    runs: runs.map((run) => {
      const policy = relations.policiesById.get(run.policyId);
      const volume = policy ? relations.volumesById.get(policy.volumeId) : undefined;
      const view = policy ? getPolicyView(policy, volume) : SEEDED_POLICY_VIEW[run.policyId];
      const requestedBy =
        run.triggeredByUserId && usersById.get(run.triggeredByUserId)
          ? (usersById.get(run.triggeredByUserId)?.email ?? "")
          : "scheduler";

      return {
        id: run.id,
        policyId: run.policyId,
        projectName: view?.projectName ?? "",
        environmentName: view?.environmentName ?? "",
        serviceName: view?.serviceName ?? "",
        targetType: view?.targetType ?? ("volume" as const),
        status: run.status,
        triggerKind: run.triggeredByUserId ? ("manual" as const) : ("scheduled" as const),
        requestedBy,
        artifactPath: run.artifactPath,
        bytesWritten: run.sizeBytes ? Number(run.sizeBytes) : null,
        startedAt: run.startedAt?.toISOString() ?? run.createdAt.toISOString(),
        finishedAt: run.completedAt?.toISOString() ?? null
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

  return run;
}

export async function queueBackupRestore(
  backupRunId: string,
  userId: string,
  email: string,
  role: AppRole
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
        requestedBy:
          restore.triggeredByUserId && usersById.get(restore.triggeredByUserId)
            ? (usersById.get(restore.triggeredByUserId)?.email ?? "")
            : "scheduler",
        destinationServerName: server?.name ?? volume?.serverId ?? "",
        sourceArtifactPath: run?.artifactPath ?? null,
        restorePath: restore.targetPath,
        validationSummary: restore.error ?? "",
        status: restore.status,
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
      environmentId: readString(metadata, "environmentId"),
      environmentName: readString(metadata, "environmentName"),
      projectName: readString(metadata, "projectName"),
      targetServerName: readString(metadata, "targetServerName", server?.name ?? volume.serverId),
      serviceName: readString(metadata, "serviceName"),
      volumeName: volume.name,
      mountPath: volume.mountPath,
      driver: readString(metadata, "driver", "local"),
      sizeBytes: Number(volume.sizeBytes ?? 0),
      backupPolicyId: backupPolicyId && policyIds.has(backupPolicyId) ? backupPolicyId : null,
      storageProvider,
      lastBackupAt: readString(metadata, "lastBackupAt") || null,
      lastRestoreTestAt: readString(metadata, "lastRestoreTestAt") || null,
      backupCoverage,
      restoreReadiness
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

// ── Schedule Management ──────────────────────────────────────

/**
 * Enable a cron schedule for a backup policy via Temporal.
 */
export async function enableBackupSchedule(
  policyId: string,
  schedule: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const [policy] = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, policyId))
    .limit(1);
  if (!policy) return null;

  // Cancel any existing cron workflow first
  if (policy.temporalWorkflowId) {
    await cancelBackupCronWorkflow(policyId);
  }

  // Start the Temporal cron workflow
  const result = await startBackupCronWorkflow(policyId, schedule);

  // Update the policy record
  await db
    .update(backupPolicies)
    .set({
      schedule,
      temporalWorkflowId: result.workflowId,
      updatedAt: new Date()
    })
    .where(eq(backupPolicies.id, policyId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `backup-policy/${policyId}`,
    action: "backup.schedule.enable",
    inputSummary: `Enabled backup schedule "${schedule}" for policy ${policy.name}`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-policy",
      resourceId: policyId,
      resourceLabel: policy.name,
      detail: `Temporal workflow ${result.workflowId} started with cron: ${schedule}`
    }
  });

  return { policyId, schedule, workflowId: result.workflowId };
}

/**
 * Disable a cron schedule for a backup policy.
 */
export async function disableBackupSchedule(
  policyId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const [policy] = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, policyId))
    .limit(1);
  if (!policy) return null;

  // Cancel the Temporal cron workflow
  await cancelBackupCronWorkflow(policyId);

  // Clear the schedule from the policy
  await db
    .update(backupPolicies)
    .set({
      schedule: null,
      temporalWorkflowId: null,
      updatedAt: new Date()
    })
    .where(eq(backupPolicies.id, policyId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `backup-policy/${policyId}`,
    action: "backup.schedule.disable",
    inputSummary: `Disabled backup schedule for policy ${policy.name}`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-policy",
      resourceId: policyId,
      resourceLabel: policy.name,
      detail: `Temporal workflow cancelled for policy ${policy.name}`
    }
  });

  return { policyId, schedule: null };
}

/**
 * Trigger a one-off backup run immediately via Temporal.
 */
export async function triggerBackupNow(
  policyId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const [policy] = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, policyId))
    .limit(1);
  if (!policy) return null;

  const result = await startOneOffBackupWorkflow(policyId, userId);

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `backup-policy/${policyId}`,
    action: "backup.trigger",
    inputSummary: `Triggered one-off backup for policy ${policy.name}`,
    permissionScope: "backup:run",
    outcome: "success",
    metadata: {
      resourceType: "backup-policy",
      resourceId: policyId,
      resourceLabel: policy.name,
      detail: `One-off backup workflow ${result.workflowId} started`
    }
  });

  return { policyId, workflowId: result.workflowId };
}

/**
 * Get backup schedule status for a policy from Temporal.
 */
export async function getScheduleStatus(policyId: string) {
  return getBackupCronStatus(policyId);
}
