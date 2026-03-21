import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { decrypt, encrypt } from "../crypto";
import { auditEntries } from "../schema/audit";
import { environmentVariables, environments, projects } from "../schema/projects";
import type { AppRole } from "@daoflow/shared";
import { resolveTeamIdForUser } from "./teams";
import {
  ENVVAR_AUDIT_CHANGED_FIELDS,
  buildEnvironmentVariableSnapshot,
  summarizeEnvironmentVariableDiff
} from "./envvar-audit";
export { listEnvironmentVariableInventory } from "./envvar-inventory";

function isSecretVariable(row: typeof environmentVariables.$inferSelect) {
  return row.isSecret === "true";
}

async function getScopedEnvironmentRecord(environmentId: string, teamId: string) {
  const [row] = await db
    .select({
      environment: environments,
      project: projects
    })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(and(eq(environments.id, environmentId), eq(projects.teamId, teamId)))
    .limit(1);

  return row ?? null;
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
  teamId?: string;
  updatedByUserId: string;
  updatedByEmail: string;
  updatedByRole: AppRole;
}

export async function upsertEnvironmentVariable(input: UpsertEnvironmentVariableInput) {
  const teamId = input.teamId ?? (await resolveTeamIdForUser(input.updatedByUserId));
  if (!teamId) return null;

  const scopedEnvironment = await getScopedEnvironmentRecord(input.environmentId, teamId);
  if (!scopedEnvironment) return null;

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
  const existingIsSecret = existing ? isSecretVariable(existing) : false;
  const beforeSnapshot = existing
    ? buildEnvironmentVariableSnapshot({
        key: existing.key,
        value: decrypt(existing.valueEncrypted),
        isSecret: existingIsSecret,
        category: existing.category as "runtime" | "build",
        source: existing.source as "inline" | "1password",
        secretRef: existing.secretRef,
        branchPattern: existing.branchPattern
      })
    : null;
  const afterSnapshot = buildEnvironmentVariableSnapshot({
    key: input.key,
    value: input.value,
    isSecret: input.isSecret,
    category: input.category,
    source: input.source ?? "inline",
    secretRef: input.secretRef ?? null,
    branchPattern: input.branchPattern ?? null
  });
  const changedFields = existing
    ? [
        decrypt(existing.valueEncrypted) !== input.value ? "value" : null,
        existingIsSecret !== input.isSecret ? "isSecret" : null,
        existing.category !== input.category ? "category" : null,
        existing.source !== (input.source ?? "inline") ? "source" : null,
        existing.secretRef !== (input.secretRef ?? null) ? "secretRef" : null,
        existing.branchPattern !== (input.branchPattern ?? null) ? "branchPattern" : null
      ].filter((field): field is string => field !== null)
    : ["value", "isSecret", "category", "source", "secretRef", "branchPattern"];
  const action = existing ? "updated" : "created";

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
    inputSummary: summarizeEnvironmentVariableDiff({
      action,
      environmentName: scopedEnvironment.environment.name,
      key: input.key,
      changedFields
    }),
    permissionScope: "env:write",
    outcome: "success",
    metadata: {
      resourceType: "env-var",
      resourceId: `${input.environmentId}/${input.key}`,
      resourceLabel: `${input.key}@${scopedEnvironment.environment.name}`,
      detail: summarizeEnvironmentVariableDiff({
        action,
        environmentName: scopedEnvironment.environment.name,
        key: input.key,
        changedFields
      }),
      redactedDiff: {
        before: beforeSnapshot,
        after: afterSnapshot,
        changedFields
      }
    }
  });

  return {
    key: input.key,
    environmentId: input.environmentId,
    environmentName: scopedEnvironment.environment.name,
    category: input.category,
    status: action
  };
}

// ─── Delete ─────────────────────────────────────────────────

export interface DeleteEnvironmentVariableInput {
  environmentId: string;
  key: string;
  teamId?: string;
  deletedByUserId: string;
  deletedByEmail: string;
  deletedByRole: AppRole;
}

export async function deleteEnvironmentVariable(input: DeleteEnvironmentVariableInput) {
  const teamId = input.teamId ?? (await resolveTeamIdForUser(input.deletedByUserId));
  if (!teamId) return null;

  const scopedEnvironment = await getScopedEnvironmentRecord(input.environmentId, teamId);
  if (!scopedEnvironment) return null;

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
  const beforeSnapshot = buildEnvironmentVariableSnapshot({
    key: existing.key,
    value: decrypt(existing.valueEncrypted),
    isSecret: isSecretVariable(existing),
    category: existing.category as "runtime" | "build",
    source: existing.source as "inline" | "1password",
    secretRef: existing.secretRef,
    branchPattern: existing.branchPattern
  });

  await db.delete(environmentVariables).where(eq(environmentVariables.id, existing.id));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.deletedByUserId,
    actorEmail: input.deletedByEmail,
    actorRole: input.deletedByRole,
    targetResource: `env-var/${input.environmentId}/${input.key}`,
    action: "envvar.delete",
    inputSummary: summarizeEnvironmentVariableDiff({
      action: "deleted",
      environmentName: scopedEnvironment.environment.name,
      key: input.key,
      changedFields: [...ENVVAR_AUDIT_CHANGED_FIELDS]
    }),
    permissionScope: "env:write",
    outcome: "success",
    metadata: {
      resourceType: "env-var",
      resourceId: `${input.environmentId}/${input.key}`,
      resourceLabel: `${input.key}@${scopedEnvironment.environment.name}`,
      detail: summarizeEnvironmentVariableDiff({
        action: "deleted",
        environmentName: scopedEnvironment.environment.name,
        key: input.key,
        changedFields: [...ENVVAR_AUDIT_CHANGED_FIELDS]
      }),
      redactedDiff: {
        before: beforeSnapshot,
        after: null,
        changedFields: [...ENVVAR_AUDIT_CHANGED_FIELDS]
      }
    }
  });

  return {
    key: input.key,
    environmentId: input.environmentId,
    environmentName: scopedEnvironment.environment.name,
    status: "deleted" as const
  };
}
