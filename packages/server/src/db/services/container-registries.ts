import type { AppRole } from "@daoflow/shared";
import { and, desc, eq, ne } from "drizzle-orm";
import {
  normalizeContainerRegistryHost,
  type ContainerRegistrySummary
} from "../../container-registries-shared";
import { db } from "../connection";
import { encrypt } from "../crypto";
import { auditEntries } from "../schema/audit";
import { containerRegistries } from "../schema/registries";
import { newId as id } from "./json-helpers";

interface RegistryActor {
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
  teamId: string;
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

function isRegistryUniquenessViolation(error: unknown): boolean {
  let current = error;
  for (let depth = 0; depth < 4 && current && typeof current === "object"; depth += 1) {
    const candidate = current as { code?: unknown; constraint?: unknown; cause?: unknown };
    if (
      candidate.code === "23505" &&
      (candidate.constraint === "container_registries_name_team_idx" ||
        candidate.constraint === "container_registries_host_team_idx")
    ) {
      return true;
    }
    current = candidate.cause;
  }
  return false;
}

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
  teamId: string;
  name: string;
  registryHost: string;
  excludeId?: string;
}) {
  const excludeCondition = input.excludeId
    ? ne(containerRegistries.id, input.excludeId)
    : undefined;
  const baseConditions = [eq(containerRegistries.teamId, input.teamId)];
  if (excludeCondition) baseConditions.push(excludeCondition);

  const [hostConflict] = await db
    .select()
    .from(containerRegistries)
    .where(and(...baseConditions, eq(containerRegistries.registryHost, input.registryHost)))
    .limit(1);
  if (hostConflict) {
    return `A registry credential for ${input.registryHost} already exists.`;
  }

  const [nameConflict] = await db
    .select()
    .from(containerRegistries)
    .where(and(...baseConditions, eq(containerRegistries.name, input.name)))
    .limit(1);
  return nameConflict ? `A registry named "${input.name}" already exists.` : null;
}

export async function registerContainerRegistry(
  input: RegisterContainerRegistryInput
): Promise<RegistryWriteResult> {
  const name = input.name.trim();
  const registryHost = normalizeContainerRegistryHost(input.registryHost);
  const username = input.username.trim();
  const conflict = await findConflictingRegistry({ ...input, name, registryHost });
  if (conflict) return { status: "conflict", message: conflict };

  let row: typeof containerRegistries.$inferSelect | undefined;
  try {
    [row] = await db
      .insert(containerRegistries)
      .values({
        id: id(),
        teamId: input.teamId,
        name,
        registryHost,
        username,
        passwordEncrypted: encrypt(input.password),
        updatedAt: new Date()
      })
      .returning();
  } catch (error) {
    if (isRegistryUniquenessViolation(error)) {
      return {
        status: "conflict",
        message:
          (await findConflictingRegistry({ ...input, name, registryHost })) ??
          "A registry with the same name or host already exists."
      };
    }
    throw error;
  }
  if (!row) throw new Error("Expected registry insert to return a row.");

  await writeRegistryAudit(
    input,
    row.id,
    "container_registry.register",
    `Registered ${registryHost} credentials for ${username}`
  );
  return { status: "ok", summary: toSummary(row) };
}

export async function updateContainerRegistry(
  input: UpdateContainerRegistryInput
): Promise<RegistryWriteResult> {
  const existing = await getContainerRegistry(input.registryId, input.teamId);
  if (!existing) return { status: "not_found" };

  const name = input.name.trim();
  const registryHost = normalizeContainerRegistryHost(input.registryHost);
  const username = input.username.trim();
  const conflict = await findConflictingRegistry({
    ...input,
    name,
    registryHost,
    excludeId: input.registryId
  });
  if (conflict) return { status: "conflict", message: conflict };

  let row: typeof containerRegistries.$inferSelect | undefined;
  try {
    [row] = await db
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
      .where(
        and(
          eq(containerRegistries.id, input.registryId),
          eq(containerRegistries.teamId, input.teamId)
        )
      )
      .returning();
  } catch (error) {
    if (isRegistryUniquenessViolation(error)) {
      return {
        status: "conflict",
        message:
          (await findConflictingRegistry({
            ...input,
            name,
            registryHost,
            excludeId: input.registryId
          })) ?? "A registry with the same name or host already exists."
      };
    }
    throw error;
  }
  if (!row) return { status: "not_found" };

  await writeRegistryAudit(
    input,
    row.id,
    "container_registry.update",
    `Updated ${registryHost} credentials for ${username}`
  );
  return { status: "ok", summary: toSummary(row) };
}

export async function deleteContainerRegistry(registryId: string, actor: RegistryActor) {
  const [row] = await db
    .delete(containerRegistries)
    .where(
      and(eq(containerRegistries.id, registryId), eq(containerRegistries.teamId, actor.teamId))
    )
    .returning();
  if (!row) return { status: "not_found" as const };

  await writeRegistryAudit(
    actor,
    registryId,
    "container_registry.delete",
    `Deleted ${row.registryHost} credentials`
  );
  return { status: "ok" as const };
}

export async function listContainerRegistrySummaries(
  teamId: string
): Promise<ContainerRegistrySummary[]> {
  const rows = await db
    .select()
    .from(containerRegistries)
    .where(eq(containerRegistries.teamId, teamId))
    .orderBy(desc(containerRegistries.createdAt));
  return rows.map(toSummary);
}

async function getContainerRegistry(registryId: string, teamId: string) {
  const [row] = await db
    .select()
    .from(containerRegistries)
    .where(and(eq(containerRegistries.id, registryId), eq(containerRegistries.teamId, teamId)))
    .limit(1);
  return row ?? null;
}

async function writeRegistryAudit(
  actor: RegistryActor,
  registryId: string,
  action: string,
  inputSummary: string
) {
  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: actor.requestedByUserId,
    actorEmail: actor.requestedByEmail,
    actorRole: actor.requestedByRole,
    organizationId: actor.teamId,
    targetResource: `container_registry/${registryId}`,
    action,
    inputSummary,
    permissionScope: "server:write",
    outcome: "success",
    metadata: { resourceType: "container_registry", resourceId: registryId, teamId: actor.teamId }
  });
}
