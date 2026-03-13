import { randomUUID } from "node:crypto";
import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { backupPolicies, backupRestores, backupRuns, volumes } from "../schema/storage";
import { servers } from "../schema/servers";
import { users } from "../schema/users";
import type { AppRole } from "@daoflow/shared";

const id = () => randomUUID().replace(/-/g, "").slice(0, 32);

type JsonRecord = Record<string, unknown>;

const SEEDED_POLICY_VIEW: Record<
  string,
  {
    projectName: string;
    environmentName: string;
    serviceName: string;
    targetType: "volume" | "database";
    storageProvider: string;
  }
> = {
  bpol_foundation_volume_daily: {
    projectName: "DaoFlow",
    environmentName: "production-us-west",
    serviceName: "postgres-volume",
    targetType: "volume",
    storageProvider: "s3-compatible"
  },
  bpol_foundation_db_hourly: {
    projectName: "DaoFlow",
    environmentName: "staging",
    serviceName: "control-plane-db",
    targetType: "database",
    storageProvider: "s3-compatible"
  }
};

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readString(record: JsonRecord, key: string, fallback = "") {
  const value = record[key];
  return typeof value === "string" ? value : fallback;
}

function getPolicyView(
  policy: typeof backupPolicies.$inferSelect,
  volume?: typeof volumes.$inferSelect
) {
  const seeded = SEEDED_POLICY_VIEW[policy.id];
  const metadata = asRecord(volume?.metadata);

  return {
    projectName: seeded?.projectName ?? readString(metadata, "projectName"),
    environmentName: seeded?.environmentName ?? readString(metadata, "environmentName"),
    serviceName: seeded?.serviceName ?? policy.name,
    targetType: seeded?.targetType ?? ("volume" as const),
    storageProvider: seeded?.storageProvider ?? "s3-compatible"
  };
}

async function loadBackupRelations() {
  const [policyRows, volumeRows, serverRows] = await Promise.all([
    db.select().from(backupPolicies),
    db.select().from(volumes),
    db.select().from(servers)
  ]);

  return {
    policiesById: new Map(policyRows.map((row) => [row.id, row])),
    volumesById: new Map(volumeRows.map((row) => [row.id, row])),
    serversById: new Map(serverRows.map((row) => [row.id, row]))
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
      const view = getPolicyView(policy, volume);
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
  const [volumeRows, policyRows, serverRows] = await Promise.all([
    db.select().from(volumes).orderBy(desc(volumes.createdAt)).limit(limit),
    db.select().from(backupPolicies),
    db.select().from(servers)
  ]);

  const policyIds = new Set(policyRows.map((policy) => policy.id));
  const serversById = new Map(serverRows.map((server) => [server.id, server]));

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
      storageProvider: backupPolicyId && policyIds.has(backupPolicyId) ? "s3-compatible" : null,
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
