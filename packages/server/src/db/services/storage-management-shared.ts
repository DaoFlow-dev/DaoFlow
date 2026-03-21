import { and, eq, ne } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { backupDestinations } from "../schema/destinations";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { backupPolicies, volumes } from "../schema/storage";
import { asRecord, readString } from "./json-helpers";

export type VolumeStatus = "active" | "inactive" | "paused";
export type PolicyStatus = "active" | "paused";
export type BackupType = "volume" | "database";
export type DatabaseEngine = "postgres" | "mysql" | "mariadb" | "mongo";

export interface ActorContext {
  userId: string;
  email: string;
  role: AppRole;
}

export interface CreateVolumeInput {
  name: string;
  serverId: string;
  mountPath: string;
  sizeBytes?: number | null;
  driver?: string;
  serviceId?: string;
  status?: VolumeStatus;
}

export interface UpdateVolumeInput extends Partial<CreateVolumeInput> {
  volumeId: string;
}

export interface CreateBackupPolicyInput {
  name: string;
  volumeId: string;
  destinationId?: string;
  backupType?: BackupType;
  databaseEngine?: DatabaseEngine | null;
  turnOff?: boolean;
  schedule?: string;
  retentionDays?: number;
  retentionDaily?: number;
  retentionWeekly?: number;
  retentionMonthly?: number;
  maxBackups?: number;
  status?: PolicyStatus;
}

export interface UpdateBackupPolicyInput extends Partial<CreateBackupPolicyInput> {
  policyId: string;
}

export type VolumeRow = typeof volumes.$inferSelect;
export type PolicyRow = typeof backupPolicies.$inferSelect;
export type ServerRow = typeof servers.$inferSelect;
export type DestinationRow = typeof backupDestinations.$inferSelect;
export type ServiceContextRow = Awaited<ReturnType<typeof findServiceContext>>;

export function trimOrNull(value?: string | null) {
  const trimmed = value?.trim();
  return trimmed ? trimmed : null;
}

export function toSizeBytes(value?: number | null) {
  if (value === undefined || value === null || Number.isNaN(value)) {
    return null;
  }

  return String(Math.max(0, Math.trunc(value)));
}

export async function findServer(serverId: string) {
  const [server] = await db.select().from(servers).where(eq(servers.id, serverId)).limit(1);
  return server ?? null;
}

export async function findDestination(destinationId: string) {
  const [destination] = await db
    .select()
    .from(backupDestinations)
    .where(eq(backupDestinations.id, destinationId))
    .limit(1);
  return destination ?? null;
}

export async function findVolume(volumeId: string) {
  const [volume] = await db.select().from(volumes).where(eq(volumes.id, volumeId)).limit(1);
  return volume ?? null;
}

export async function findPolicy(policyId: string) {
  const [policy] = await db
    .select()
    .from(backupPolicies)
    .where(eq(backupPolicies.id, policyId))
    .limit(1);
  return policy ?? null;
}

export async function findServiceContext(serviceId: string) {
  const [row] = await db
    .select({
      service: services,
      environment: environments,
      project: projects
    })
    .from(services)
    .innerJoin(environments, eq(environments.id, services.environmentId))
    .innerJoin(projects, eq(projects.id, services.projectId))
    .where(eq(services.id, serviceId))
    .limit(1);

  return row ?? null;
}

export function buildVolumeMetadata(input: {
  existing?: Record<string, unknown>;
  server: ServerRow;
  serviceContext?: ServiceContextRow | null;
  driver?: string | null;
}) {
  const existing = input.existing ?? {};
  const serviceContext = input.serviceContext ?? null;

  return {
    ...existing,
    projectId: serviceContext?.project.id ?? null,
    projectName: serviceContext?.project.name ?? "",
    environmentId: serviceContext?.environment.id ?? null,
    environmentName: serviceContext?.environment.name ?? "",
    serviceId: serviceContext?.service.id ?? null,
    serviceName: serviceContext?.service.name ?? "",
    targetServerId: input.server.id,
    targetServerName: input.server.name,
    driver: trimOrNull(input.driver) ?? readString(existing, "driver", "local"),
    backupPolicyId: readString(existing, "backupPolicyId") || null,
    backupCoverage: readString(existing, "backupCoverage", "missing"),
    restoreReadiness: readString(existing, "restoreReadiness", "untested")
  };
}

export async function syncVolumeBackupMetadata(volumeId: string, backupPolicyId: string | null) {
  const volume = await findVolume(volumeId);
  if (!volume) {
    return;
  }

  const metadata = asRecord(volume.metadata);
  const nextMetadata = {
    ...metadata,
    backupPolicyId,
    backupCoverage: backupPolicyId ? "protected" : "missing",
    restoreReadiness: readString(metadata, "restoreReadiness", "untested")
  };

  await db
    .update(volumes)
    .set({
      metadata: nextMetadata,
      updatedAt: new Date()
    })
    .where(eq(volumes.id, volumeId));
}

export function toVolumeView(
  volume: VolumeRow,
  server: ServerRow | null,
  policyId: string | null = null
) {
  const metadata = asRecord(volume.metadata);
  const linkedPolicyId = policyId ?? (readString(metadata, "backupPolicyId") || null);

  return {
    id: volume.id,
    name: volume.name,
    serverId: volume.serverId,
    serverName: server?.name ?? readString(metadata, "targetServerName", volume.serverId),
    mountPath: volume.mountPath,
    sizeBytes: Number(volume.sizeBytes ?? 0),
    driver: readString(metadata, "driver", "local"),
    serviceId: readString(metadata, "serviceId") || null,
    serviceName: readString(metadata, "serviceName") || null,
    environmentId: readString(metadata, "environmentId") || null,
    environmentName: readString(metadata, "environmentName") || null,
    projectId: readString(metadata, "projectId") || null,
    projectName: readString(metadata, "projectName") || null,
    status: volume.status,
    backupPolicyId: linkedPolicyId,
    createdAt: volume.createdAt.toISOString(),
    updatedAt: volume.updatedAt.toISOString()
  };
}

export function toPolicyView(
  policy: PolicyRow,
  volume: VolumeRow,
  destination: DestinationRow | null
) {
  return {
    id: policy.id,
    name: policy.name,
    volumeId: policy.volumeId,
    volumeName: volume.name,
    destinationId: policy.destinationId,
    destinationName: destination?.name ?? null,
    backupType: policy.backupType,
    databaseEngine: policy.databaseEngine,
    turnOff: policy.turnOff === 1,
    schedule: policy.schedule,
    retentionDays: policy.retentionDays,
    retentionDaily: policy.retentionDaily,
    retentionWeekly: policy.retentionWeekly,
    retentionMonthly: policy.retentionMonthly,
    maxBackups: policy.maxBackups,
    status: policy.status,
    createdAt: policy.createdAt.toISOString(),
    updatedAt: policy.updatedAt.toISOString()
  };
}

export async function ensureUniqueVolume(input: {
  serverId: string;
  name: string;
  excludeVolumeId?: string;
}) {
  const conditions = [eq(volumes.serverId, input.serverId), eq(volumes.name, input.name)];
  if (input.excludeVolumeId) {
    conditions.push(ne(volumes.id, input.excludeVolumeId));
  }

  const [existing] = await db
    .select()
    .from(volumes)
    .where(and(...conditions))
    .limit(1);
  return existing ?? null;
}

export async function ensureVolumePolicySlot(volumeId: string, excludePolicyId?: string) {
  const conditions = [eq(backupPolicies.volumeId, volumeId)];
  if (excludePolicyId) {
    conditions.push(ne(backupPolicies.id, excludePolicyId));
  }

  const [existing] = await db
    .select()
    .from(backupPolicies)
    .where(and(...conditions))
    .limit(1);
  return existing ?? null;
}
