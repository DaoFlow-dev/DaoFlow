import { eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { backupPolicies, volumes } from "../schema/storage";
import { asRecord, newId as id, readString } from "./json-helpers";
import {
  buildVolumeMetadata,
  ensureUniqueVolume,
  findServer,
  findServiceContext,
  findVolume,
  toSizeBytes,
  toVolumeView,
  trimOrNull,
  type ActorContext,
  type CreateVolumeInput,
  type UpdateVolumeInput
} from "./storage-management-shared";

export async function createVolume(input: CreateVolumeInput, actor: ActorContext) {
  const server = await findServer(input.serverId);
  if (!server) {
    return { status: "not-found" as const, entity: "server" };
  }

  const duplicate = await ensureUniqueVolume({ serverId: input.serverId, name: input.name });
  if (duplicate) {
    return {
      status: "conflict" as const,
      message: `A volume named "${input.name}" is already registered on ${server.name}.`
    };
  }

  const serviceContext = input.serviceId ? await findServiceContext(input.serviceId) : null;
  if (input.serviceId && !serviceContext) {
    return { status: "not-found" as const, entity: "service" };
  }

  const now = new Date();
  const volumeId = id();
  const metadata = buildVolumeMetadata({
    server,
    serviceContext,
    driver: input.driver,
    existing: {}
  });

  const [volume] = await db
    .insert(volumes)
    .values({
      id: volumeId,
      name: input.name,
      serverId: input.serverId,
      mountPath: input.mountPath,
      sizeBytes: toSizeBytes(input.sizeBytes),
      status: input.status ?? "active",
      metadata,
      createdAt: now,
      updatedAt: now
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: actor.userId,
    actorEmail: actor.email,
    actorRole: actor.role,
    targetResource: `volume/${volumeId}`,
    action: "volume.create",
    inputSummary: `Registered volume ${input.name} on ${server.name}.`,
    permissionScope: "volumes:write",
    outcome: "success",
    metadata: {
      resourceType: "volume",
      resourceId: volumeId,
      resourceLabel: input.name,
      detail: `Mount path ${input.mountPath}`
    }
  });

  return {
    status: "ok" as const,
    volume: toVolumeView(volume, server)
  };
}

export async function updateVolume(input: UpdateVolumeInput, actor: ActorContext) {
  const current = await findVolume(input.volumeId);
  if (!current) {
    return { status: "not-found" as const, entity: "volume" };
  }

  const server = await findServer(input.serverId ?? current.serverId);
  if (!server) {
    return { status: "not-found" as const, entity: "server" };
  }

  const nextName = trimOrNull(input.name) ?? current.name;
  const duplicate = await ensureUniqueVolume({
    serverId: server.id,
    name: nextName,
    excludeVolumeId: current.id
  });
  if (duplicate) {
    return {
      status: "conflict" as const,
      message: `A volume named "${nextName}" is already registered on ${server.name}.`
    };
  }

  const currentMetadata = asRecord(current.metadata);
  const nextServiceId =
    input.serviceId !== undefined
      ? trimOrNull(input.serviceId)
      : readString(currentMetadata, "serviceId");
  const serviceContext = nextServiceId ? await findServiceContext(nextServiceId) : null;
  if (nextServiceId && !serviceContext) {
    return { status: "not-found" as const, entity: "service" };
  }

  const metadata = buildVolumeMetadata({
    existing: currentMetadata,
    server,
    serviceContext,
    driver: input.driver ?? readString(currentMetadata, "driver", "local")
  });

  const [volume] = await db
    .update(volumes)
    .set({
      name: nextName,
      serverId: server.id,
      mountPath: trimOrNull(input.mountPath) ?? current.mountPath,
      sizeBytes: input.sizeBytes !== undefined ? toSizeBytes(input.sizeBytes) : current.sizeBytes,
      status: input.status ?? current.status,
      metadata,
      updatedAt: new Date()
    })
    .where(eq(volumes.id, input.volumeId))
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: actor.userId,
    actorEmail: actor.email,
    actorRole: actor.role,
    targetResource: `volume/${input.volumeId}`,
    action: "volume.update",
    inputSummary: `Updated volume ${volume.name}.`,
    permissionScope: "volumes:write",
    outcome: "success",
    metadata: {
      resourceType: "volume",
      resourceId: input.volumeId,
      resourceLabel: volume.name,
      detail: `Mount path ${volume.mountPath}`
    }
  });

  return {
    status: "ok" as const,
    volume: toVolumeView(volume, server)
  };
}

export async function deleteVolume(volumeId: string, actor: ActorContext) {
  const volume = await findVolume(volumeId);
  if (!volume) {
    return { status: "not-found" as const, entity: "volume" };
  }

  const [linkedPolicy] = await db
    .select({ id: backupPolicies.id })
    .from(backupPolicies)
    .where(eq(backupPolicies.volumeId, volumeId))
    .limit(1);
  if (linkedPolicy) {
    return {
      status: "has-dependencies" as const,
      message: "Remove the linked backup policy before deleting this volume."
    };
  }

  await db.delete(volumes).where(eq(volumes.id, volumeId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: actor.userId,
    actorEmail: actor.email,
    actorRole: actor.role,
    targetResource: `volume/${volumeId}`,
    action: "volume.delete",
    inputSummary: `Deleted volume ${volume.name}.`,
    permissionScope: "volumes:write",
    outcome: "success",
    metadata: {
      resourceType: "volume",
      resourceId: volumeId,
      resourceLabel: volume.name,
      detail: `Mount path ${volume.mountPath}`
    }
  });

  return { status: "ok" as const, deleted: true };
}
