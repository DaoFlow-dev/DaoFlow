import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { backupDestinations } from "../schema/destinations";
import { externalBackupArtifacts } from "../schema/external-backup-artifacts";
import { projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { volumes } from "../schema/storage";
import { readManagedDatabaseConfigFromConfig } from "../../managed-database-config";
import { resolveExecutionTarget, type ExecutionTarget } from "../../worker/execution-target";
import { resolveVolumeTeamId } from "./backup-resource-team";
import { asRecord, readString } from "./json-helpers";
import { resolveServiceRuntime } from "./service-runtime";
import {
  resolveExternalArtifact,
  toExternalBackupArtifactView
} from "./external-backup-artifact-shared";

export async function listExternalBackupArtifacts(input: {
  teamId: string;
  destinationId?: string;
  limit?: number;
}) {
  const rows = await db
    .select({ artifact: externalBackupArtifacts, destinationName: backupDestinations.name })
    .from(externalBackupArtifacts)
    .innerJoin(backupDestinations, eq(backupDestinations.id, externalBackupArtifacts.destinationId))
    .where(
      input.destinationId
        ? and(
            eq(externalBackupArtifacts.teamId, input.teamId),
            eq(externalBackupArtifacts.destinationId, input.destinationId)
          )
        : eq(externalBackupArtifacts.teamId, input.teamId)
    )
    .orderBy(desc(externalBackupArtifacts.createdAt))
    .limit(input.limit ?? 50);
  return {
    artifacts: rows.map((row) => toExternalBackupArtifactView(row.artifact, row.destinationName))
  };
}

export async function getExternalBackupArtifact(artifactId: string, teamId: string) {
  const [row] = await db
    .select({ artifact: externalBackupArtifacts, destinationName: backupDestinations.name })
    .from(externalBackupArtifacts)
    .innerJoin(backupDestinations, eq(backupDestinations.id, externalBackupArtifacts.destinationId))
    .where(
      and(eq(externalBackupArtifacts.id, artifactId), eq(externalBackupArtifacts.teamId, teamId))
    )
    .limit(1);
  return row ? toExternalBackupArtifactView(row.artifact, row.destinationName) : null;
}

export type ExternalPostgresTargetMetadata = {
  databaseName: string;
  databaseUser: string;
  runtimeServiceName: string;
  targetServiceId: string;
  targetServiceUpdatedAt: string;
  runtimeBinding:
    { kind: "service"; serviceId: string } | { kind: "container"; containerName: string };
};

export type ExternalPostgresRestoreRuntime = ExternalPostgresTargetMetadata & {
  target: ExecutionTarget;
  runtime:
    | { kind: "container"; containerName: string }
    | { kind: "compose"; projectName: string; serviceName: string };
};

export async function resolveExternalPostgresTargetMetadata(
  volume: typeof volumes.$inferSelect,
  teamId: string
): Promise<ExternalPostgresTargetMetadata | null> {
  const metadata = asRecord(volume.metadata);
  const serviceId = readString(metadata, "serviceId");
  if (serviceId) {
    const [row] = await db
      .select({ service: services, projectTeamId: projects.teamId })
      .from(services)
      .innerJoin(projects, eq(projects.id, services.projectId))
      .where(eq(services.id, serviceId))
      .limit(1);
    const managed = row ? readManagedDatabaseConfigFromConfig(row.service.config) : null;
    if (
      !row ||
      row.projectTeamId !== teamId ||
      (row.service.targetServerId && row.service.targetServerId !== volume.serverId) ||
      managed?.kind !== "postgres" ||
      managed.backupEngine !== "postgres" ||
      managed.volumeId !== volume.id ||
      !managed.databaseName ||
      !managed.username ||
      !managed.serviceName
    ) {
      return null;
    }
    return {
      databaseName: managed.databaseName,
      databaseUser: managed.username,
      runtimeServiceName: managed.serviceName,
      targetServiceId: row.service.id,
      targetServiceUpdatedAt: row.service.updatedAt.toISOString(),
      runtimeBinding: { kind: "service", serviceId: row.service.id }
    };
  }

  const databaseEngine = readString(metadata, "databaseEngine");
  const databaseName = readString(metadata, "databaseName");
  const databaseUser = readString(metadata, "databaseUser");
  const containerName = readString(metadata, "containerName");
  if (databaseEngine !== "postgres" || !databaseName || !databaseUser || !containerName)
    return null;
  return {
    databaseName,
    databaseUser,
    runtimeServiceName: containerName,
    targetServiceId: `manual-volume:${volume.id}`,
    targetServiceUpdatedAt: volume.updatedAt.toISOString(),
    runtimeBinding: { kind: "container", containerName }
  };
}

export async function resolveExternalPostgresRestoreRuntime(input: {
  volume: typeof volumes.$inferSelect;
  teamId: string;
  restoreId: string;
}): Promise<ExternalPostgresRestoreRuntime | null> {
  const metadata = await resolveExternalPostgresTargetMetadata(input.volume, input.teamId);
  if (!metadata) return null;

  if (metadata.runtimeBinding.kind === "container") {
    const [server] = await db
      .select()
      .from(servers)
      .where(and(eq(servers.id, input.volume.serverId), eq(servers.teamId, input.teamId)))
      .limit(1);
    if (!server) return null;
    return {
      ...metadata,
      target: await resolveExecutionTarget(
        server,
        `external_restore_${input.restoreId}`,
        input.teamId
      ),
      runtime: { kind: "container", containerName: metadata.runtimeBinding.containerName }
    };
  }

  const resolved = await resolveServiceRuntime(metadata.runtimeBinding.serviceId, {
    teamId: input.teamId
  });
  if (
    resolved.status !== "ok" ||
    resolved.runtime.service.id !== metadata.targetServiceId ||
    resolved.runtime.server.id !== input.volume.serverId
  ) {
    return null;
  }
  return {
    ...metadata,
    target: resolved.runtime.target,
    runtime:
      resolved.runtime.kind === "compose"
        ? {
            kind: "compose",
            projectName: resolved.runtime.projectName,
            serviceName: resolved.runtime.composeServiceName
          }
        : { kind: "container", containerName: resolved.runtime.containerName }
  };
}

export async function resolveExternalArtifactRestoreTarget(input: {
  artifactId: string;
  targetVolumeId: string;
  teamId: string;
}) {
  const [resolved, volumeRows] = await Promise.all([
    resolveExternalArtifact(input.artifactId, input.teamId),
    db.select().from(volumes).where(eq(volumes.id, input.targetVolumeId)).limit(1)
  ]);
  const volume = volumeRows[0];
  if (!resolved || !volume || (await resolveVolumeTeamId(volume)) !== input.teamId) return null;
  const postgres = await resolveExternalPostgresTargetMetadata(volume, input.teamId);
  return postgres ? { ...resolved, volume, ...postgres } : null;
}
