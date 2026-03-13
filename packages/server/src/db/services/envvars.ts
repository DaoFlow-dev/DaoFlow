import { randomUUID } from "node:crypto";
import { eq, desc, and, sql } from "drizzle-orm";
import { db } from "../connection";
import { environmentVariables, environments, projects } from "../schema/projects";
import { auditEntries } from "../schema/audit";
import { encrypt, decrypt, displayValue } from "../crypto";
import type { AppRole } from "@daoflow/shared";

const id = () => randomUUID().replace(/-/g, "").slice(0, 32);

export interface UpsertEnvironmentVariableInput {
  environmentId: string;
  key: string;
  value: string;
  isSecret: boolean;
  category: "runtime" | "build";
  branchPattern?: string | null;
  updatedByUserId: string;
  updatedByEmail: string;
  updatedByRole: AppRole;
}

export async function upsertEnvironmentVariable(input: UpsertEnvironmentVariableInput) {
  // Verify environment exists
  const env = await db.select().from(environments).where(eq(environments.id, input.environmentId)).limit(1);
  if (!env[0]) return null;

  const encryptedValue = encrypt(input.value);

  // Check if variable exists
  const existing = await db
    .select()
    .from(environmentVariables)
    .where(and(
      eq(environmentVariables.environmentId, input.environmentId),
      eq(environmentVariables.key, input.key)
    ))
    .limit(1);

  if (existing[0]) {
    await db
      .update(environmentVariables)
      .set({
        valueEncrypted: encryptedValue,
        isSecret: input.isSecret ? "true" : "false",
        category: input.category,
        branchPattern: input.branchPattern ?? null,
        updatedAt: new Date()
      })
      .where(eq(environmentVariables.id, existing[0].id));
  } else {
    await db.insert(environmentVariables).values({
      environmentId: input.environmentId,
      key: input.key,
      valueEncrypted: encryptedValue,
      isSecret: input.isSecret ? "true" : "false",
      category: input.category,
      branchPattern: input.branchPattern ?? null
    });
  }

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.updatedByUserId,
    actorEmail: input.updatedByEmail,
    actorRole: input.updatedByRole,
    targetResource: `env-var/${input.environmentId}/${input.key}`,
    action: existing[0] ? "envvar.updated" : "envvar.created",
    inputSummary: `${existing[0] ? "Updated" : "Created"} ${input.key} in ${input.environmentId}`,
    permissionScope: "secrets:write",
    outcome: "success"
  });

  return {
    key: input.key,
    environmentId: input.environmentId,
    environmentName: input.environmentId,
    category: input.category,
    status: existing[0] ? "updated" : "created"
  };
}

export async function listEnvironmentVariableInventory(environmentId?: string, limit = 50) {
  const query = environmentId
    ? db.select().from(environmentVariables).where(eq(environmentVariables.environmentId, environmentId))
    : db.select().from(environmentVariables);

  const rows = await query.orderBy(desc(environmentVariables.createdAt)).limit(limit);

  const variables = rows.map(row => ({
    id: row.id,
    environmentId: row.environmentId,
    environmentName: row.environmentId,
    projectName: "",
    key: row.key,
    displayValue: displayValue(row.valueEncrypted, row.isSecret === "true"),
    isSecret: row.isSecret === "true",
    category: row.category,
    branchPattern: row.branchPattern,
    source: "manual" as const,
    updatedByEmail: "",
    updatedAt: row.updatedAt.toISOString()
  }));

  return {
    summary: {
      totalVariables: variables.length,
      secretVariables: variables.filter(v => v.isSecret).length,
      runtimeVariables: variables.filter(v => v.category === "runtime").length,
      buildVariables: variables.filter(v => v.category === "build").length
    },
    variables
  };
}
