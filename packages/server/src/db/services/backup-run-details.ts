import { eq } from "drizzle-orm";
import { db } from "../connection";
import { backupRestores, backupRuns, type BackupRunLogEntry } from "../schema/storage";
import {
  getBackupOperationStatusTone,
  getPolicyView,
  loadBackupRelations,
  loadUsersById,
  readRequestedByEmail
} from "./backup-view-helpers";

export const MAX_BACKUP_RUN_LOG_ENTRIES = 200;
export const MAX_BACKUP_RUN_LOG_MESSAGE_LENGTH = 2_000;
export const MAX_BACKUP_RUN_LOG_PHASE_LENGTH = 64;

export function getBackupRunLogsState(
  logEntries: BackupRunLogEntry[] | null,
  status: string
): "unavailable" | "empty" | "streaming" | "available" {
  if (logEntries === null) {
    return "unavailable";
  }

  if (logEntries.length === 0) {
    return "empty";
  }

  if (status === "queued" || status === "running") {
    return "streaming";
  }

  return "available";
}

export function normalizeBackupRunLogEntry(
  entry: Omit<BackupRunLogEntry, "timestamp"> & { timestamp?: string }
): BackupRunLogEntry {
  return {
    timestamp: entry.timestamp ?? new Date().toISOString(),
    level: entry.level,
    phase: entry.phase.slice(0, MAX_BACKUP_RUN_LOG_PHASE_LENGTH),
    message: entry.message.slice(0, MAX_BACKUP_RUN_LOG_MESSAGE_LENGTH)
  };
}

export function appendBackupRunLogEntries(
  currentEntries: BackupRunLogEntry[] | null,
  entry: Omit<BackupRunLogEntry, "timestamp"> & { timestamp?: string }
) {
  const normalizedEntry = normalizeBackupRunLogEntry(entry);
  const nextEntries = Array.isArray(currentEntries)
    ? [...currentEntries, normalizedEntry]
    : [normalizedEntry];

  if (nextEntries.length <= MAX_BACKUP_RUN_LOG_ENTRIES) {
    return nextEntries;
  }

  return nextEntries.slice(-MAX_BACKUP_RUN_LOG_ENTRIES);
}

export async function getBackupRunDetails(runId: string) {
  const [run, usersById, relations, restores] = await Promise.all([
    db
      .select()
      .from(backupRuns)
      .where(eq(backupRuns.id, runId))
      .limit(1)
      .then((rows) => rows[0] ?? null),
    loadUsersById(),
    loadBackupRelations(),
    db.select().from(backupRestores).where(eq(backupRestores.backupRunId, runId))
  ]);

  if (!run) {
    return null;
  }

  const policy = relations.policiesById.get(run.policyId);
  const volume = policy ? relations.volumesById.get(policy.volumeId) : undefined;
  const destination = policy?.destinationId
    ? relations.destinationsById.get(policy.destinationId)
    : null;
  const server = volume ? relations.serversById.get(volume.serverId) : undefined;
  const view = policy ? getPolicyView(policy, volume, destination) : null;
  const requestedBy = readRequestedByEmail(run.triggeredByUserId, usersById);
  const logEntries = Array.isArray(run.logEntries) ? run.logEntries : null;

  return {
    id: run.id,
    policyId: run.policyId,
    policyName: policy?.name ?? run.policyId,
    projectName: view?.projectName ?? "",
    environmentName: view?.environmentName ?? "",
    serviceName: view?.serviceName ?? "",
    targetType: view?.targetType ?? ("volume" as const),
    destinationName: destination?.name ?? destination?.provider ?? "(none)",
    destinationProvider: destination?.provider ?? null,
    destinationServerName: server?.name ?? volume?.serverId ?? "",
    mountPath: volume?.mountPath ?? null,
    backupType: policy?.backupType ?? "volume",
    databaseEngine: policy?.databaseEngine ?? null,
    scheduleLabel: policy?.schedule ?? null,
    retentionCount: policy?.retentionDays ?? null,
    status: run.status,
    statusTone: getBackupOperationStatusTone(run.status),
    triggerKind: run.triggeredByUserId ? ("manual" as const) : ("scheduled" as const),
    requestedBy,
    artifactPath: run.artifactPath,
    bytesWritten: run.sizeBytes ? Number(run.sizeBytes) : null,
    checksum: run.checksum,
    verifiedAt: run.verifiedAt?.toISOString() ?? null,
    startedAt: run.startedAt?.toISOString() ?? run.createdAt.toISOString(),
    finishedAt: run.completedAt?.toISOString() ?? null,
    error: run.error,
    restoreCount: restores.length,
    logsState: getBackupRunLogsState(logEntries, run.status),
    logEntries: logEntries ?? []
  };
}

export async function appendBackupRunLogEntry(
  runId: string,
  entry: Omit<BackupRunLogEntry, "timestamp"> & { timestamp?: string }
) {
  const [run] = await db.select().from(backupRuns).where(eq(backupRuns.id, runId)).limit(1);

  if (!run) {
    return;
  }

  const nextEntries = appendBackupRunLogEntries(run.logEntries, entry);

  await db.update(backupRuns).set({ logEntries: nextEntries }).where(eq(backupRuns.id, runId));
}
