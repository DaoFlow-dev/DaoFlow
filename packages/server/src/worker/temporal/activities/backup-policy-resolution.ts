import { eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import { backupPolicies, volumes } from "../../../db/schema/storage";
import { servers } from "../../../db/schema/servers";
import { resolveTeamScopedDestinationForVolume } from "../../../db/services/backup-resource-team";
import type { BackupPolicyResolved } from "./backup-activity-types";
import { resolveVolumeSourceKind } from "./volume-source-kind";

export async function resolveBackupPolicy(policyId: string): Promise<BackupPolicyResolved | null> {
  const [policy] = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, policyId))
    .limit(1);

  if (!policy || policy.status !== "active") return null;

  const [volume] = await db.select().from(volumes).where(eq(volumes.id, policy.volumeId)).limit(1);

  if (!volume) return null;

  const [server] = await db.select().from(servers).where(eq(servers.id, volume.serverId)).limit(1);

  if (!server) return null;

  if (!policy.destinationId) return null;

  const destinationScope = await resolveTeamScopedDestinationForVolume(
    volume,
    policy.destinationId
  );
  if (!destinationScope) return null;
  const { destination, teamId } = destinationScope;

  const volumeMeta =
    volume.metadata && typeof volume.metadata === "object"
      ? (volume.metadata as Record<string, unknown>)
      : {};

  return {
    policyId: policy.id,
    teamId,
    policyName: policy.name,
    volumeId: volume.id,
    volumeName: volume.name,
    mountPath: volume.mountPath,
    sourceKind: resolveVolumeSourceKind(volume.metadata),
    serverId: server.id,
    serverName: server.name,
    serverHost: server.host,
    retentionDays: policy.retentionDays,
    backupType: policy.backupType ?? "volume",
    databaseEngine: policy.databaseEngine ?? undefined,
    turnOff: policy.turnOff === 1,
    retentionDaily: policy.retentionDaily,
    retentionWeekly: policy.retentionWeekly,
    retentionMonthly: policy.retentionMonthly,
    maxBackups: policy.maxBackups,
    containerName:
      typeof volumeMeta.containerName === "string" ? volumeMeta.containerName : undefined,
    projectName: typeof volumeMeta.projectName === "string" ? volumeMeta.projectName : undefined,
    environmentName:
      typeof volumeMeta.environmentName === "string" ? volumeMeta.environmentName : undefined,
    serviceName: typeof volumeMeta.serviceName === "string" ? volumeMeta.serviceName : undefined,
    databaseName: typeof volumeMeta.databaseName === "string" ? volumeMeta.databaseName : undefined,
    databaseUser: typeof volumeMeta.databaseUser === "string" ? volumeMeta.databaseUser : undefined,
    destinationId: destination.id
  };
}
