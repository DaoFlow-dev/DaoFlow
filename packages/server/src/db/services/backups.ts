import { randomUUID } from "node:crypto";
import { eq, desc, sql } from "drizzle-orm";
import { db } from "../connection";
import { volumes, backupPolicies, backupRuns, backupRestores } from "../schema/storage";
import { auditEntries } from "../schema/audit";
import type { AppRole } from "@daoflow/shared";

const id = () => randomUUID().replace(/-/g, "").slice(0, 32);

export async function listBackupOverview(limit = 12) {
  const policies = await db.select().from(backupPolicies).orderBy(desc(backupPolicies.createdAt));
  const runs = await db.select().from(backupRuns).orderBy(desc(backupRuns.createdAt)).limit(limit);

  return {
    summary: {
      totalPolicies: policies.length,
      queuedRuns: runs.filter((r) => r.status === "queued").length,
      runningRuns: runs.filter((r) => r.status === "running").length,
      succeededRuns: runs.filter((r) => r.status === "succeeded").length,
      failedRuns: runs.filter((r) => r.status === "failed").length
    },
    policies: policies.map((p) => ({
      id: p.id,
      projectName: p.name,
      environmentName: "",
      serviceName: p.volumeId,
      targetType: "volume" as const,
      storageProvider: p.storageTarget ?? "s3-compatible",
      scheduleLabel: p.schedule,
      retentionCount: p.retentionDays,
      nextRunAt: new Date().toISOString(),
      lastRunAt: null as string | null
    })),
    runs: runs.map((r) => ({
      id: r.id,
      policyId: r.policyId,
      projectName: "",
      environmentName: "",
      serviceName: "",
      targetType: "volume" as const,
      status: r.status,
      triggerKind: "manual" as const,
      requestedBy: "",
      artifactPath: r.artifactPath,
      bytesWritten: r.sizeBytes ? Number(r.sizeBytes) : null,
      startedAt: r.startedAt?.toISOString() ?? new Date().toISOString(),
      finishedAt: r.completedAt?.toISOString() ?? null
    }))
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

  const runId = id();
  const [run] = await db
    .insert(backupRuns)
    .values({
      id: runId,
      policyId,
      status: "queued",
      startedAt: new Date()
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `backup-run/${runId}`,
    action: "backup.triggered",
    inputSummary: `Manual backup triggered for policy ${policyId}`,
    permissionScope: "backup:run",
    outcome: "success"
  });

  return run;
}

export async function queueBackupRestore(
  backupRunId: string,
  userId: string,
  email: string,
  role: AppRole
) {
  const run = await db.select().from(backupRuns).where(eq(backupRuns.id, backupRunId)).limit(1);
  if (!run[0] || run[0].status !== "succeeded" || !run[0].artifactPath) return null;

  const restoreId = id();
  const [restore] = await db
    .insert(backupRestores)
    .values({
      id: restoreId,
      backupRunId,
      status: "queued",
      targetPath: run[0].artifactPath,
      startedAt: new Date()
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: userId,
    actorEmail: email,
    actorRole: role,
    targetResource: `backup-restore/${restoreId}`,
    action: "backup.restore.queued",
    inputSummary: `Restore queued from backup run ${backupRunId}`,
    permissionScope: "backup:restore",
    outcome: "success"
  });

  return restore;
}

export async function listBackupRestoreQueue(limit = 12) {
  const restores = await db
    .select()
    .from(backupRestores)
    .orderBy(desc(backupRestores.createdAt))
    .limit(limit);

  return {
    summary: {
      totalRequests: restores.length,
      queuedRequests: restores.filter((r) => r.status === "queued").length,
      runningRequests: restores.filter((r) => r.status === "running").length,
      succeededRequests: restores.filter((r) => r.status === "succeeded").length,
      failedRequests: restores.filter((r) => r.status === "failed").length
    },
    requests: restores.map((r) => ({
      ...r,
      policyId: "",
      projectName: "",
      environmentName: "",
      serviceName: "",
      targetType: "volume" as const,
      requestedBy: "",
      destinationServerName: "",
      sourceArtifactPath: r.targetPath,
      restorePath: r.targetPath,
      validationSummary: "",
      requestedAt: r.createdAt.toISOString(),
      finishedAt: r.completedAt?.toISOString() ?? null
    }))
  };
}

export async function listPersistentVolumeInventory(limit = 12) {
  const vols = await db.select().from(volumes).orderBy(desc(volumes.createdAt)).limit(limit);

  return {
    summary: {
      totalVolumes: vols.length,
      protectedVolumes: 0,
      attentionVolumes: 0,
      attachedBytes: vols.reduce((sum, v) => sum + Number(v.sizeBytes ?? 0), 0)
    },
    volumes: vols.map((v) => ({
      id: v.id,
      environmentId: "",
      environmentName: "",
      projectName: "",
      targetServerName: v.serverId,
      serviceName: "",
      volumeName: v.name,
      mountPath: v.mountPath,
      driver: "local",
      sizeBytes: Number(v.sizeBytes ?? 0),
      backupPolicyId: null as string | null,
      storageProvider: null as string | null,
      lastBackupAt: null as string | null,
      lastRestoreTestAt: null as string | null,
      backupCoverage: "missing" as const,
      restoreReadiness: "untested" as const
    }))
  };
}
