import { eq } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { decrypt, encrypt } from "../crypto";
import { auditEntries } from "../schema/audit";
import { environmentVariables } from "../schema/projects";
import { serviceVariables } from "../schema/services";
import { readBranchPattern, normalizeStoredBranchPattern } from "./envvar-layering";
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
  findExistingScopedVariable,
  resolveScopedVariableTarget,
  type ServiceVariableRow
} from "./envvar-targeting";

export { listEnvironmentVariableInventory } from "./envvar-inventory";

function isSecretVariable(row: { isSecret: string }) {
  return row.isSecret === "true";
}

function normalizeCategory(value: string): "runtime" | "build" {
  return value === "build" ? "build" : "runtime";
}

function normalizeSource(value: string | null | undefined): "inline" | "1password" {
  return value === "1password" ? "1password" : "inline";
}

function buildVariableSnapshot(input: {
  key: string;
  value: string;
  isSecret: boolean;
  category: string;
  source: string | null | undefined;
  secretRef: string | null;
  branchPattern: string;
}) {
  return buildEnvironmentVariableSnapshot({
    key: input.key,
    value: input.value,
    isSecret: input.isSecret,
    category: normalizeCategory(input.category),
    source: normalizeSource(input.source),
    secretRef: input.secretRef,
    branchPattern: readBranchPattern(input.branchPattern)
  });
}

export interface UpsertEnvironmentVariableInput {
  environmentId: string;
  serviceId?: string | null;
  scope?: "environment" | "service";
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
  const scope = input.scope ?? (input.serviceId ? "service" : "environment");
  const target = await resolveScopedVariableTarget({
    environmentId: input.environmentId,
    serviceId: input.serviceId,
    scope,
    actorUserId: input.updatedByUserId,
    teamId: input.teamId
  });
  if (!target) {
    return null;
  }

  const encryptedValue = encrypt(input.value);
  const branchPattern = normalizeStoredBranchPattern(input.branchPattern);
  const existing = await findExistingScopedVariable({
    target,
    key: input.key,
    branchPattern
  });
  const beforeSnapshot = existing
    ? buildVariableSnapshot({
        key: existing.key,
        value: decrypt(existing.valueEncrypted),
        isSecret: isSecretVariable(existing),
        category: existing.category,
        source: existing.source,
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
    branchPattern: readBranchPattern(branchPattern)
  });
  const changedFields = existing
    ? [
        decrypt(existing.valueEncrypted) !== input.value ? "value" : null,
        isSecretVariable(existing) !== input.isSecret ? "isSecret" : null,
        existing.category !== input.category ? "category" : null,
        normalizeSource(existing.source) !== (input.source ?? "inline") ? "source" : null,
        existing.secretRef !== (input.secretRef ?? null) ? "secretRef" : null,
        existing.branchPattern !== branchPattern ? "branchPattern" : null
      ].filter((field): field is string => field !== null)
    : ["value", "isSecret", "category", "source", "secretRef", "branchPattern"];
  const action = existing ? "updated" : "created";
  const detail = summarizeEnvironmentVariableDiff({
    action,
    targetLabel: buildVariableTargetLabel(target),
    key: input.key,
    changedFields
  });

  if (target.scope === "service" && target.serviceId) {
    if (existing) {
      await db
        .update(serviceVariables)
        .set({
          valueEncrypted: encryptedValue,
          isSecret: input.isSecret ? "true" : "false",
          category: input.category,
          source: input.source ?? "inline",
          secretRef: input.secretRef ?? null,
          branchPattern,
          updatedByUserId: input.updatedByUserId,
          updatedAt: new Date()
        })
        .where(eq(serviceVariables.id, (existing as ServiceVariableRow).id));
    } else {
      await db.insert(serviceVariables).values({
        serviceId: target.serviceId,
        key: input.key,
        valueEncrypted: encryptedValue,
        isSecret: input.isSecret ? "true" : "false",
        category: input.category,
        source: input.source ?? "inline",
        secretRef: input.secretRef ?? null,
        branchPattern,
        updatedByUserId: input.updatedByUserId
      });
    }
  } else {
    if (existing) {
      await db
        .update(environmentVariables)
        .set({
          valueEncrypted: encryptedValue,
          isSecret: input.isSecret ? "true" : "false",
          category: input.category,
          source: input.source ?? "inline",
          secretRef: input.secretRef ?? null,
          branchPattern,
          updatedByUserId: input.updatedByUserId,
          updatedAt: new Date()
        })
        .where(eq(environmentVariables.id, (existing as EnvironmentVariableRow).id));
    } else {
      await db.insert(environmentVariables).values({
        environmentId: target.environmentId,
        key: input.key,
        valueEncrypted: encryptedValue,
        isSecret: input.isSecret ? "true" : "false",
        category: input.category,
        source: input.source ?? "inline",
        secretRef: input.secretRef ?? null,
        branchPattern,
        updatedByUserId: input.updatedByUserId
      });
    }
  }

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.updatedByUserId,
    actorEmail: input.updatedByEmail,
    actorRole: input.updatedByRole,
    targetResource: buildVariableTargetResource({
      scope: target.scope,
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
      ...buildVariableResourceMetadata({
        target,
        key: input.key,
        branchPattern
      }),
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
    environmentId: target.environmentId,
    environmentName: target.environmentName,
    serviceId: target.serviceId,
    serviceName: target.serviceName,
    category: input.category,
    scope: target.scope,
    branchPattern: readBranchPattern(branchPattern),
    status: action
  };
}

export interface DeleteEnvironmentVariableInput {
  environmentId: string;
  serviceId?: string | null;
  scope?: "environment" | "service";
  key: string;
  branchPattern?: string | null;
  teamId?: string;
  deletedByUserId: string;
  deletedByEmail: string;
  deletedByRole: AppRole;
}

export async function deleteEnvironmentVariable(input: DeleteEnvironmentVariableInput) {
  const scope = input.scope ?? (input.serviceId ? "service" : "environment");
  const target = await resolveScopedVariableTarget({
    environmentId: input.environmentId,
    serviceId: input.serviceId,
    scope,
    actorUserId: input.deletedByUserId,
    teamId: input.teamId
  });
  if (!target) {
    return null;
  }

  const branchPattern = normalizeStoredBranchPattern(input.branchPattern);
  const existing = await findExistingScopedVariable({
    target,
    key: input.key,
    branchPattern
  });

  if (!existing) {
    return null;
  }

  const beforeSnapshot = buildVariableSnapshot({
    key: existing.key,
    value: decrypt(existing.valueEncrypted),
    isSecret: isSecretVariable(existing),
    category: existing.category,
    source: existing.source,
    secretRef: existing.secretRef,
    branchPattern: existing.branchPattern
  });
  const detail = summarizeEnvironmentVariableDiff({
    action: "deleted",
    targetLabel: buildVariableTargetLabel(target),
    key: input.key,
    changedFields: [...ENVVAR_AUDIT_CHANGED_FIELDS]
  });

  if (target.scope === "service") {
    await db
      .delete(serviceVariables)
      .where(eq(serviceVariables.id, (existing as ServiceVariableRow).id));
  } else {
    await db
      .delete(environmentVariables)
      .where(eq(environmentVariables.id, (existing as EnvironmentVariableRow).id));
  }

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.deletedByUserId,
    actorEmail: input.deletedByEmail,
    actorRole: input.deletedByRole,
    targetResource: buildVariableTargetResource({
      scope: target.scope,
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
      ...buildVariableResourceMetadata({
        target,
        key: input.key,
        branchPattern
      }),
      detail,
      redactedDiff: {
        before: beforeSnapshot,
        after: null,
        changedFields: [...ENVVAR_AUDIT_CHANGED_FIELDS]
      }
    }
  });

  return {
    key: input.key,
    environmentId: target.environmentId,
    environmentName: target.environmentName,
    serviceId: target.serviceId,
    serviceName: target.serviceName,
    scope: target.scope,
    branchPattern: readBranchPattern(branchPattern),
    status: "deleted" as const
  };
}
