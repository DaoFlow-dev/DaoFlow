import { eq } from "drizzle-orm";
import { db } from "../../../db/connection";
import type { BackupProvider } from "../../../db/schema/destinations";
import { backupDestinations } from "../../../db/schema/destinations";
import { backupPolicies, volumes } from "../../../db/schema/storage";
import { servers } from "../../../db/schema/servers";
import type { BackupPolicyResolved } from "./backup-activity-types";

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

  const [dest] = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, policy.destinationId))
    .limit(1);

  if (!dest) return null;

  const volumeMeta =
    volume.metadata && typeof volume.metadata === "object"
      ? (volume.metadata as Record<string, unknown>)
      : {};

  return {
    policyId: policy.id,
    policyName: policy.name,
    volumeId: volume.id,
    volumeName: volume.name,
    mountPath: volume.mountPath,
    serverId: server.id,
    serverName: server.name,
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
    databasePassword:
      typeof volumeMeta.databasePassword === "string" ? volumeMeta.databasePassword : undefined,
    destination: {
      id: dest.id,
      provider: dest.provider as BackupProvider,
      accessKey: dest.accessKey,
      secretAccessKey: dest.secretAccessKey,
      endpoint: dest.endpoint,
      region: dest.region,
      bucket: dest.bucket,
      oauthToken: dest.oauthToken,
      rcloneConfig: dest.rcloneConfig,
      localPath: dest.localPath,
      encryptionMode: dest.encryptionMode,
      encryptionPassword: dest.encryptionPassword,
      encryptionSalt: dest.encryptionSalt,
      filenameEncryption: dest.filenameEncryption
    }
  };
}
