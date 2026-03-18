import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../connection";
import { encrypt, displayValue } from "../crypto";
import { auditEntries } from "../schema/audit";
import { environmentVariables, environments, projects } from "../schema/projects";
import { users } from "../schema/users";
import type { AppRole } from "@daoflow/shared";

const FOUNDATION_ENVIRONMENT_VARIABLE_IDS: Record<number, string> = {
  1001: "envvar_prod_public_origin",
  1002: "envvar_prod_database_password",
  1003: "envvar_staging_preview_flag"
};

function getEnvironmentVariableStatusTone(isSecret: boolean) {
  return isSecret ? "failed" : "queued";
}

function getEnvironmentVariableStatusLabel(
  isSecret: boolean,
  category: (typeof environmentVariables.$inferSelect)["category"]
) {
  if (isSecret) {
    return "Secret";
  }

  return `${category.slice(0, 1).toUpperCase()}${category.slice(1)}`;
}

function getEnvironmentVariableId(row: typeof environmentVariables.$inferSelect) {
  return FOUNDATION_ENVIRONMENT_VARIABLE_IDS[row.id] ?? `envvar_${row.id}`;
}

export interface UpsertEnvironmentVariableInput {
  environmentId: string;
  key: string;
  value: string;
  isSecret: boolean;
  category: "runtime" | "build";
  source?: "inline" | "1password";
  secretRef?: string | null;
  branchPattern?: string | null;
  updatedByUserId: string;
  updatedByEmail: string;
  updatedByRole: AppRole;
}

export async function upsertEnvironmentVariable(input: UpsertEnvironmentVariableInput) {
  const env = await db
    .select()
    .from(environments)
    .where(eq(environments.id, input.environmentId))
    .limit(1);
  if (!env[0]) return null;

  const encryptedValue = encrypt(input.value);
  const [existing] = await db
    .select()
    .from(environmentVariables)
    .where(
      and(
        eq(environmentVariables.environmentId, input.environmentId),
        eq(environmentVariables.key, input.key)
      )
    )
    .limit(1);

  if (existing) {
    await db
      .update(environmentVariables)
      .set({
        valueEncrypted: encryptedValue,
        isSecret: input.isSecret ? "true" : "false",
        category: input.category,
        source: input.source ?? "inline",
        secretRef: input.secretRef ?? null,
        branchPattern: input.branchPattern ?? null,
        updatedByUserId: input.updatedByUserId,
        updatedAt: new Date()
      })
      .where(eq(environmentVariables.id, existing.id));
  } else {
    await db.insert(environmentVariables).values({
      environmentId: input.environmentId,
      key: input.key,
      valueEncrypted: encryptedValue,
      isSecret: input.isSecret ? "true" : "false",
      category: input.category,
      source: input.source ?? "inline",
      secretRef: input.secretRef ?? null,
      branchPattern: input.branchPattern ?? null,
      updatedByUserId: input.updatedByUserId
    });
  }

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.updatedByUserId,
    actorEmail: input.updatedByEmail,
    actorRole: input.updatedByRole,
    targetResource: `env-var/${input.environmentId}/${input.key}`,
    action: existing ? "envvar.update" : "envvar.create",
    inputSummary: `${existing ? "Updated" : "Created"} ${input.key} in ${env[0].name}.`,
    permissionScope: "secrets:write",
    outcome: "success",
    metadata: {
      resourceType: "env-var",
      resourceId: `${input.environmentId}/${input.key}`,
      resourceLabel: `${input.key}@${env[0].name}`,
      detail: `${existing ? "Updated" : "Created"} ${input.key} in ${env[0].name}.`
    }
  });

  return {
    key: input.key,
    environmentId: input.environmentId,
    environmentName: env[0].name,
    category: input.category,
    status: existing ? "updated" : "created"
  };
}

export async function listEnvironmentVariableInventory(environmentId?: string, limit = 50) {
  const query = environmentId
    ? db
        .select()
        .from(environmentVariables)
        .where(eq(environmentVariables.environmentId, environmentId))
    : db.select().from(environmentVariables);

  const rows = await query.orderBy(desc(environmentVariables.createdAt)).limit(limit);
  const environmentIds = [...new Set(rows.map((row) => row.environmentId))];
  const updatedByUserIds = [
    ...new Set(
      rows
        .map((row) => row.updatedByUserId)
        .filter((userId): userId is string => typeof userId === "string")
    )
  ];

  const environmentRows =
    environmentIds.length > 0
      ? await db.select().from(environments).where(inArray(environments.id, environmentIds))
      : [];
  const projectRows =
    environmentRows.length > 0
      ? await db
          .select()
          .from(projects)
          .where(inArray(projects.id, [...new Set(environmentRows.map((row) => row.projectId))]))
      : [];
  const userRows =
    updatedByUserIds.length > 0
      ? await db.select().from(users).where(inArray(users.id, updatedByUserIds))
      : [];

  const environmentsById = new Map(environmentRows.map((row) => [row.id, row]));
  const projectsById = new Map(projectRows.map((row) => [row.id, row]));
  const usersById = new Map(userRows.map((row) => [row.id, row]));

  const variables = rows.map((row) => {
    const environment = environmentsById.get(row.environmentId);
    const project = environment ? projectsById.get(environment.projectId) : undefined;
    const updatedByUser = row.updatedByUserId ? usersById.get(row.updatedByUserId) : undefined;

    return {
      id: getEnvironmentVariableId(row),
      environmentId: row.environmentId,
      environmentName: environment?.name ?? row.environmentId,
      projectName: project?.name ?? "",
      key: row.key,
      displayValue: displayValue(row.valueEncrypted, row.isSecret === "true"),
      isSecret: row.isSecret === "true",
      category: row.category,
      branchPattern: row.branchPattern,
      source: row.source,
      secretRef: row.secretRef,
      statusTone: getEnvironmentVariableStatusTone(row.isSecret === "true"),
      statusLabel: getEnvironmentVariableStatusLabel(row.isSecret === "true", row.category),
      updatedByEmail: updatedByUser?.email ?? "",
      updatedAt: row.updatedAt.toISOString()
    };
  });

  return {
    summary: {
      totalVariables: variables.length,
      secretVariables: variables.filter((variable) => variable.isSecret).length,
      runtimeVariables: variables.filter((variable) => variable.category === "runtime").length,
      buildVariables: variables.filter((variable) => variable.category === "build").length
    },
    variables
  };
}

// ─── Delete ─────────────────────────────────────────────────

export interface DeleteEnvironmentVariableInput {
  environmentId: string;
  key: string;
  deletedByUserId: string;
  deletedByEmail: string;
  deletedByRole: AppRole;
}

export async function deleteEnvironmentVariable(input: DeleteEnvironmentVariableInput) {
  const env = await db
    .select()
    .from(environments)
    .where(eq(environments.id, input.environmentId))
    .limit(1);
  if (!env[0]) return null;

  const [existing] = await db
    .select()
    .from(environmentVariables)
    .where(
      and(
        eq(environmentVariables.environmentId, input.environmentId),
        eq(environmentVariables.key, input.key)
      )
    )
    .limit(1);

  if (!existing) return null;

  await db.delete(environmentVariables).where(eq(environmentVariables.id, existing.id));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.deletedByUserId,
    actorEmail: input.deletedByEmail,
    actorRole: input.deletedByRole,
    targetResource: `env-var/${input.environmentId}/${input.key}`,
    action: "envvar.delete",
    inputSummary: `Deleted ${input.key} from ${env[0].name}.`,
    permissionScope: "env:write",
    outcome: "success",
    metadata: {
      resourceType: "env-var",
      resourceId: `${input.environmentId}/${input.key}`,
      resourceLabel: `${input.key}@${env[0].name}`,
      detail: `Deleted ${input.key} from ${env[0].name}.`
    }
  });

  return {
    key: input.key,
    environmentId: input.environmentId,
    environmentName: env[0].name,
    status: "deleted" as const
  };
}
