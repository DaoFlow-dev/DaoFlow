import { and, eq, sql } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { decrypt, encrypt } from "../crypto";
import { auditEntries } from "../schema/audit";
import { environmentVariables, projectVariables } from "../schema/projects";
import { serviceVariables } from "../schema/services";
import {
  getEnvironmentVariableOrigin,
  normalizeStoredBranchPattern,
  readBranchPattern
} from "./envvar-layering";
import {
  ENVVAR_AUDIT_CHANGED_FIELDS,
  buildEnvironmentVariableSnapshot,
  summarizeEnvironmentVariableDiff
} from "./envvar-audit";
import {
  buildVariableResourceMetadata,
  buildVariableTargetLabel,
  buildVariableTargetResource,
  type EnvironmentVariableRow,
  type ProjectVariableRow,
  resolveScopedVariableTarget,
  type ScopedVariableTarget,
  type ServiceVariableRow
} from "./envvar-targeting";

export { listEnvironmentVariableInventory } from "./envvar-inventory";

type VariableScope = "project" | "environment" | "service";
type EnvironmentVariableTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];
type ScopedVariableRow = ProjectVariableRow | EnvironmentVariableRow | ServiceVariableRow;

const nextEnvironmentVariableRevision = sql<number>`nextval('environment_variable_revision_seq')`;

function isSecretVariable(row: { isSecret: string; source: string | null | undefined }) {
  return row.isSecret === "true" || normalizeSource(row.source) === "1password";
}

function normalizeCategory(value: string): "runtime" | "build" {
  return value === "build" ? "build" : "runtime";
}

function normalizeSource(value: string | null | undefined): "inline" | "1password" {
  return value === "1password" ? "1password" : "inline";
}

function resolveVariableScope(input: {
  scope?: VariableScope;
  projectId?: string | null;
  serviceId?: string | null;
}): VariableScope {
  return input.scope ?? (input.projectId ? "project" : input.serviceId ? "service" : "environment");
}

function changedFieldsForScope(scope: VariableScope) {
  return scope === "project"
    ? ENVVAR_AUDIT_CHANGED_FIELDS.filter((field) => field !== "branchPattern")
    : [...ENVVAR_AUDIT_CHANGED_FIELDS];
}

function readStoredBranchPattern(row: ScopedVariableRow) {
  return "branchPattern" in row ? row.branchPattern : "";
}

function buildVariableSnapshot(input: {
  key: string;
  value: string;
  isSecret: boolean;
  category: string;
  source: string | null | undefined;
  secretRef: string | null;
  branchPattern: string;
  scope: VariableScope;
  revision: number;
}) {
  return buildEnvironmentVariableSnapshot({
    key: input.key,
    value: input.value,
    isSecret: input.isSecret,
    category: normalizeCategory(input.category),
    source: normalizeSource(input.source),
    secretRef: input.secretRef,
    branchPattern: readBranchPattern(input.branchPattern),
    origin: getEnvironmentVariableOrigin(input),
    revision: input.revision
  });
}

function variableTargetId(target: ScopedVariableTarget) {
  if (target.scope === "project") return target.projectId;
  return target.scope === "service" ? target.serviceId : target.environmentId;
}

async function lockScopedVariableMutation(
  tx: EnvironmentVariableTransaction,
  input: { target: ScopedVariableTarget; key: string; branchPattern: string }
) {
  const lockKey = JSON.stringify({
    scope: input.target.scope,
    targetId: variableTargetId(input.target),
    key: input.key,
    branchPattern: input.branchPattern
  });

  await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtextextended(${lockKey}, 0))`);
}

async function findLockedScopedVariable(
  tx: EnvironmentVariableTransaction,
  input: { target: ScopedVariableTarget; key: string; branchPattern: string }
): Promise<ScopedVariableRow | null> {
  if (input.target.scope === "project") {
    const [row] = await tx
      .select()
      .from(projectVariables)
      .where(
        and(
          eq(projectVariables.projectId, input.target.projectId),
          eq(projectVariables.key, input.key)
        )
      )
      .limit(1)
      .for("update");
    return row ?? null;
  }

  if (input.target.scope === "service") {
    const [row] = await tx
      .select()
      .from(serviceVariables)
      .where(
        and(
          eq(serviceVariables.serviceId, input.target.serviceId),
          eq(serviceVariables.key, input.key),
          eq(serviceVariables.branchPattern, input.branchPattern)
        )
      )
      .limit(1)
      .for("update");
    return row ?? null;
  }

  const [row] = await tx
    .select()
    .from(environmentVariables)
    .where(
      and(
        eq(environmentVariables.environmentId, input.target.environmentId),
        eq(environmentVariables.key, input.key),
        eq(environmentVariables.branchPattern, input.branchPattern)
      )
    )
    .limit(1)
    .for("update");
  return row ?? null;
}

function requirePersistedVariable<T>(row: T | undefined, scope: VariableScope): T {
  if (!row) {
    throw new Error(`Unable to persist ${scope} environment variable mutation.`);
  }

  return row;
}

async function persistScopedVariable(input: {
  tx: EnvironmentVariableTransaction;
  target: ScopedVariableTarget;
  existing: ScopedVariableRow | null;
  key: string;
  encryptedValue: string;
  isSecret: boolean;
  category: "runtime" | "build";
  source: "inline" | "1password";
  secretRef: string | null;
  branchPattern: string;
  updatedByUserId: string;
}): Promise<ScopedVariableRow> {
  const values = {
    valueEncrypted: input.encryptedValue,
    isSecret: input.isSecret ? "true" : "false",
    category: input.category,
    source: input.source,
    secretRef: input.secretRef,
    updatedByUserId: input.updatedByUserId,
    updatedAt: new Date()
  };

  if (input.target.scope === "project") {
    if (input.existing) {
      const [row] = await input.tx
        .update(projectVariables)
        .set({ ...values, revision: nextEnvironmentVariableRevision })
        .where(eq(projectVariables.id, (input.existing as ProjectVariableRow).id))
        .returning();
      return requirePersistedVariable(row, input.target.scope);
    }

    const [row] = await input.tx
      .insert(projectVariables)
      .values({
        ...values,
        projectId: input.target.projectId,
        key: input.key
      })
      .returning();
    return requirePersistedVariable(row, input.target.scope);
  }

  if (input.target.scope === "service") {
    if (input.existing) {
      const [row] = await input.tx
        .update(serviceVariables)
        .set({
          ...values,
          branchPattern: input.branchPattern,
          revision: nextEnvironmentVariableRevision
        })
        .where(eq(serviceVariables.id, (input.existing as ServiceVariableRow).id))
        .returning();
      return requirePersistedVariable(row, input.target.scope);
    }

    const [row] = await input.tx
      .insert(serviceVariables)
      .values({
        ...values,
        serviceId: input.target.serviceId,
        key: input.key,
        branchPattern: input.branchPattern
      })
      .returning();
    return requirePersistedVariable(row, input.target.scope);
  }

  if (input.existing) {
    const [row] = await input.tx
      .update(environmentVariables)
      .set({
        ...values,
        branchPattern: input.branchPattern,
        revision: nextEnvironmentVariableRevision
      })
      .where(eq(environmentVariables.id, (input.existing as EnvironmentVariableRow).id))
      .returning();
    return requirePersistedVariable(row, input.target.scope);
  }

  const [row] = await input.tx
    .insert(environmentVariables)
    .values({
      ...values,
      environmentId: input.target.environmentId,
      key: input.key,
      branchPattern: input.branchPattern
    })
    .returning();
  return requirePersistedVariable(row, input.target.scope);
}

function changedFieldsForMutation(input: {
  existing: ScopedVariableRow | null;
  existingValue: string | null;
  scope: VariableScope;
  value: string;
  isSecret: boolean;
  category: "runtime" | "build";
  source: "inline" | "1password";
  secretRef: string | null;
  branchPattern: string;
}) {
  if (!input.existing) {
    return changedFieldsForScope(input.scope);
  }

  return [
    input.existingValue !== input.value ? "value" : null,
    (input.existing.isSecret === "true") !== input.isSecret ? "isSecret" : null,
    input.existing.category !== input.category ? "category" : null,
    normalizeSource(input.existing.source) !== input.source ? "source" : null,
    input.existing.secretRef !== input.secretRef ? "secretRef" : null,
    input.scope !== "project" && readStoredBranchPattern(input.existing) !== input.branchPattern
      ? "branchPattern"
      : null
  ].filter((field): field is string => field !== null);
}

export interface UpsertEnvironmentVariableInput {
  projectId?: string | null;
  environmentId?: string | null;
  serviceId?: string | null;
  scope?: VariableScope;
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
  const scope = resolveVariableScope(input);
  const target = await resolveScopedVariableTarget({
    projectId: input.projectId,
    environmentId: input.environmentId,
    serviceId: input.serviceId,
    scope,
    actorUserId: input.updatedByUserId,
    teamId: input.teamId
  });
  if (!target) {
    return null;
  }

  const source = input.source ?? "inline";
  const secretRef = input.secretRef ?? null;
  const branchPattern =
    scope === "project" ? "" : normalizeStoredBranchPattern(input.branchPattern);
  const encryptedValue = encrypt(input.value);

  return db.transaction(async (tx) => {
    await lockScopedVariableMutation(tx, { target, key: input.key, branchPattern });
    const existing = await findLockedScopedVariable(tx, { target, key: input.key, branchPattern });
    const existingValue = existing ? decrypt(existing.valueEncrypted) : null;
    const action = existing ? "updated" : "created";
    const changedFields = changedFieldsForMutation({
      existing,
      existingValue,
      scope,
      value: input.value,
      isSecret: input.isSecret,
      category: input.category,
      source,
      secretRef,
      branchPattern
    });
    const detail = summarizeEnvironmentVariableDiff({
      action,
      targetLabel: buildVariableTargetLabel(target),
      key: input.key,
      changedFields
    });
    const beforeSnapshot = existing
      ? buildVariableSnapshot({
          key: existing.key,
          value: existingValue ?? "",
          isSecret: isSecretVariable(existing),
          category: existing.category,
          source: existing.source,
          secretRef: existing.secretRef,
          branchPattern: readStoredBranchPattern(existing),
          scope: target.scope,
          revision: existing.revision
        })
      : null;
    const persisted = await persistScopedVariable({
      tx,
      target,
      existing,
      key: input.key,
      encryptedValue,
      isSecret: input.isSecret,
      category: input.category,
      source,
      secretRef,
      branchPattern,
      updatedByUserId: input.updatedByUserId
    });
    const afterSnapshot = buildVariableSnapshot({
      key: persisted.key,
      value: input.value,
      isSecret: isSecretVariable(persisted),
      category: persisted.category,
      source: persisted.source,
      secretRef: persisted.secretRef,
      branchPattern: readStoredBranchPattern(persisted),
      scope: target.scope,
      revision: persisted.revision
    });

    await tx.insert(auditEntries).values({
      actorType: "user",
      actorId: input.updatedByUserId,
      actorEmail: input.updatedByEmail,
      actorRole: input.updatedByRole,
      targetResource: buildVariableTargetResource({
        scope: target.scope,
        projectId: target.projectId,
        environmentId: target.environmentId,
        serviceId: target.serviceId,
        key: input.key,
        branchPattern
      }),
      action: existing ? "envvar.update" : "envvar.create",
      inputSummary: detail,
      permissionScope: "env:write",
      outcome: "success",
      metadata: {
        ...buildVariableResourceMetadata({ target, key: input.key, branchPattern }),
        detail,
        redactedDiff: {
          before: beforeSnapshot,
          after: afterSnapshot,
          changedFields
        }
      }
    });

    return {
      key: input.key,
      projectId: target.projectId,
      projectName: target.projectName,
      environmentId: target.environmentId,
      environmentName: target.environmentName,
      serviceId: target.serviceId,
      serviceName: target.serviceName,
      category: input.category,
      scope: target.scope,
      origin: getEnvironmentVariableOrigin({ scope: target.scope, branchPattern }),
      branchPattern: readBranchPattern(branchPattern),
      revision: persisted.revision,
      status: action
    };
  });
}

export interface DeleteEnvironmentVariableInput {
  projectId?: string | null;
  environmentId?: string | null;
  serviceId?: string | null;
  scope?: VariableScope;
  key: string;
  branchPattern?: string | null;
  teamId?: string;
  deletedByUserId: string;
  deletedByEmail: string;
  deletedByRole: AppRole;
}

export async function deleteEnvironmentVariable(input: DeleteEnvironmentVariableInput) {
  const scope = resolveVariableScope(input);
  const target = await resolveScopedVariableTarget({
    projectId: input.projectId,
    environmentId: input.environmentId,
    serviceId: input.serviceId,
    scope,
    actorUserId: input.deletedByUserId,
    teamId: input.teamId
  });
  if (!target) {
    return null;
  }

  const branchPattern =
    scope === "project" ? "" : normalizeStoredBranchPattern(input.branchPattern);

  return db.transaction(async (tx) => {
    await lockScopedVariableMutation(tx, { target, key: input.key, branchPattern });
    const existing = await findLockedScopedVariable(tx, { target, key: input.key, branchPattern });
    if (!existing) {
      return null;
    }

    const changedFields = changedFieldsForScope(scope);
    const detail = summarizeEnvironmentVariableDiff({
      action: "deleted",
      targetLabel: buildVariableTargetLabel(target),
      key: input.key,
      changedFields
    });
    const beforeSnapshot = buildVariableSnapshot({
      key: existing.key,
      value: decrypt(existing.valueEncrypted),
      isSecret: isSecretVariable(existing),
      category: existing.category,
      source: existing.source,
      secretRef: existing.secretRef,
      branchPattern: readStoredBranchPattern(existing),
      scope: target.scope,
      revision: existing.revision
    });

    if (target.scope === "project") {
      await tx
        .delete(projectVariables)
        .where(eq(projectVariables.id, (existing as ProjectVariableRow).id));
    } else if (target.scope === "service") {
      await tx
        .delete(serviceVariables)
        .where(eq(serviceVariables.id, (existing as ServiceVariableRow).id));
    } else {
      await tx
        .delete(environmentVariables)
        .where(eq(environmentVariables.id, (existing as EnvironmentVariableRow).id));
    }

    await tx.insert(auditEntries).values({
      actorType: "user",
      actorId: input.deletedByUserId,
      actorEmail: input.deletedByEmail,
      actorRole: input.deletedByRole,
      targetResource: buildVariableTargetResource({
        scope: target.scope,
        projectId: target.projectId,
        environmentId: target.environmentId,
        serviceId: target.serviceId,
        key: input.key,
        branchPattern
      }),
      action: "envvar.delete",
      inputSummary: detail,
      permissionScope: "env:write",
      outcome: "success",
      metadata: {
        ...buildVariableResourceMetadata({ target, key: input.key, branchPattern }),
        detail,
        redactedDiff: {
          before: beforeSnapshot,
          after: null,
          changedFields
        }
      }
    });

    return {
      key: input.key,
      projectId: target.projectId,
      projectName: target.projectName,
      environmentId: target.environmentId,
      environmentName: target.environmentName,
      serviceId: target.serviceId,
      serviceName: target.serviceName,
      scope: target.scope,
      origin: getEnvironmentVariableOrigin({ scope: target.scope, branchPattern }),
      branchPattern: readBranchPattern(branchPattern),
      revision: existing.revision,
      status: "deleted" as const
    };
  });
}
