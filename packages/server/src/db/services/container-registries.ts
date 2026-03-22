import type { AppRole } from "@daoflow/shared";
import { and, desc, eq, inArray, ne } from "drizzle-orm";
import {
  collectContainerRegistryHostsFromImageReferences,
  normalizeContainerRegistryHost,
  type ContainerRegistryCredential,
  type ContainerRegistrySummary
} from "../../container-registries-shared";
import { db } from "../connection";
import { decrypt, encrypt } from "../crypto";
import { auditEntries } from "../schema/audit";
import { containerRegistries } from "../schema/registries";
import { newId as id } from "./json-helpers";

interface RegistryActor {
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface RegisterContainerRegistryInput extends RegistryActor {
  name: string;
  registryHost: string;
  username: string;
  password: string;
}

export interface UpdateContainerRegistryInput extends RegistryActor {
  registryId: string;
  name: string;
  registryHost: string;
  username: string;
  password?: string;
}

type RegistryWriteResult =
  | { status: "ok"; summary: ContainerRegistrySummary }
  | { status: "not_found" }
  | { status: "conflict"; message: string };

function toSummary(row: typeof containerRegistries.$inferSelect): ContainerRegistrySummary {
  return {
    id: row.id,
    name: row.name,
    registryHost: row.registryHost,
    username: row.username,
    createdAt: row.createdAt,
    updatedAt: row.updatedAt
  };
}

async function findConflictingRegistry(input: {
  name: string;
  registryHost: string;
  excludeId?: string;
}) {
  const excludeCondition = input.excludeId
    ? ne(containerRegistries.id, input.excludeId)
    : undefined;
  const [hostConflict] = await db
    .select()
    .from(containerRegistries)
    .where(
      excludeCondition
        ? and(eq(containerRegistries.registryHost, input.registryHost), excludeCondition)
        : eq(containerRegistries.registryHost, input.registryHost)
    )
    .limit(1);
  if (hostConflict) {
    return `A registry credential for ${input.registryHost} already exists.`;
  }

  const [nameConflict] = await db
    .select()
    .from(containerRegistries)
    .where(
      excludeCondition
        ? and(eq(containerRegistries.name, input.name), excludeCondition)
        : eq(containerRegistries.name, input.name)
    )
    .limit(1);
  if (nameConflict) {
    return `A registry named "${input.name}" already exists.`;
  }

  return null;
}

async function writeRegistryAudit(input: {
  actor: RegistryActor;
  registryId: string;
  action: string;
  inputSummary: string;
}) {
  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.actor.requestedByUserId,
    actorEmail: input.actor.requestedByEmail,
    actorRole: input.actor.requestedByRole,
    targetResource: `container_registry/${input.registryId}`,
    action: input.action,
    inputSummary: input.inputSummary,
    permissionScope: "server:write",
    outcome: "success",
    metadata: {
      resourceType: "container_registry",
      resourceId: input.registryId
    }
  });
}

export async function registerContainerRegistry(
  input: RegisterContainerRegistryInput
): Promise<RegistryWriteResult> {
  const name = input.name.trim();
  const registryHost = normalizeContainerRegistryHost(input.registryHost);
  const username = input.username.trim();
  const conflict = await findConflictingRegistry({ name, registryHost });
  if (conflict) {
    return { status: "conflict", message: conflict };
  }

  const [row] = await db
    .insert(containerRegistries)
    .values({
      id: id(),
      name,
      registryHost,
      username,
      passwordEncrypted: encrypt(input.password),
      updatedAt: new Date()
    })
    .returning();

  if (!row) {
    throw new Error("Expected registry insert to return a row.");
  }

  await writeRegistryAudit({
    actor: input,
    registryId: row.id,
    action: "container_registry.register",
    inputSummary: `Registered ${registryHost} credentials for ${username}`
  });

  return { status: "ok", summary: toSummary(row) };
}

export async function updateContainerRegistry(
  input: UpdateContainerRegistryInput
): Promise<RegistryWriteResult> {
  const existing = await getContainerRegistry(input.registryId);
  if (!existing) {
    return { status: "not_found" };
  }

  const name = input.name.trim();
  const registryHost = normalizeContainerRegistryHost(input.registryHost);
  const username = input.username.trim();
  const conflict = await findConflictingRegistry({
    name,
    registryHost,
    excludeId: input.registryId
  });
  if (conflict) {
    return { status: "conflict", message: conflict };
  }

  const [row] = await db
    .update(containerRegistries)
    .set({
      name,
      registryHost,
      username,
      passwordEncrypted: input.password?.trim()
        ? encrypt(input.password)
        : existing.passwordEncrypted,
      updatedAt: new Date()
    })
    .where(eq(containerRegistries.id, input.registryId))
    .returning();

  if (!row) {
    return { status: "not_found" };
  }

  await writeRegistryAudit({
    actor: input,
    registryId: row.id,
    action: "container_registry.update",
    inputSummary: `Updated ${registryHost} credentials for ${username}`
  });

  return { status: "ok", summary: toSummary(row) };
}

export async function deleteContainerRegistry(
  registryId: string,
  actor: RegistryActor
): Promise<{ status: "ok" } | { status: "not_found" }> {
  const [row] = await db
    .delete(containerRegistries)
    .where(eq(containerRegistries.id, registryId))
    .returning();

  if (!row) {
    return { status: "not_found" };
  }

  await writeRegistryAudit({
    actor,
    registryId,
    action: "container_registry.delete",
    inputSummary: `Deleted ${row.registryHost} credentials`
  });

  return { status: "ok" };
}

export async function listContainerRegistrySummaries(): Promise<ContainerRegistrySummary[]> {
  const rows = await db
    .select()
    .from(containerRegistries)
    .orderBy(desc(containerRegistries.createdAt));
  return rows.map(toSummary);
}

export async function listAllContainerRegistryCredentials(): Promise<
  ContainerRegistryCredential[]
> {
  const rows = await db
    .select()
    .from(containerRegistries)
    .orderBy(desc(containerRegistries.createdAt));
  return rows.map((row) => ({
    id: row.id,
    registryHost: row.registryHost,
    username: row.username,
    password: decrypt(row.passwordEncrypted)
  }));
}

export async function listContainerRegistryCredentialsByImageReferences(
  imageReferences: Iterable<string | null | undefined>
): Promise<ContainerRegistryCredential[]> {
  const registryHosts = collectContainerRegistryHostsFromImageReferences(imageReferences);
  if (registryHosts.length === 0) {
    return [];
  }

  const rows = await db
    .select()
    .from(containerRegistries)
    .where(inArray(containerRegistries.registryHost, registryHosts))
    .orderBy(desc(containerRegistries.createdAt));

  return rows.map((row) => ({
    id: row.id,
    registryHost: row.registryHost,
    username: row.username,
    password: decrypt(row.passwordEncrypted)
  }));
}

async function getContainerRegistry(registryId: string) {
  const [row] = await db
    .select()
    .from(containerRegistries)
    .where(eq(containerRegistries.id, registryId))
    .limit(1);
  return row ?? null;
}
