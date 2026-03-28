import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { decrypt } from "../crypto";
import { environmentVariables, environments, projects } from "../schema/projects";
import { serviceVariables, services } from "../schema/services";
import { users } from "../schema/users";
import {
  type EnvironmentVariableCategory,
  normalizeStoredBranchPattern,
  resolveEffectiveEnvironmentVariables,
  sortLayeredEnvironmentVariables,
  toEnvironmentVariableInventoryRecord,
  type LayeredEnvironmentVariableRecord
} from "./envvar-layering";

const FOUNDATION_ENVIRONMENT_VARIABLE_IDS: Record<number, string> = {
  1001: "envvar_prod_public_origin",
  1002: "envvar_prod_database_password",
  1003: "envvar_staging_preview_flag"
};

function getEnvironmentVariableId(row: typeof environmentVariables.$inferSelect) {
  return FOUNDATION_ENVIRONMENT_VARIABLE_IDS[row.id] ?? `envvar_${row.id}`;
}

function getServiceVariableId(row: typeof serviceVariables.$inferSelect) {
  return `svcvar_${row.id}`;
}

function normalizeCategory(value: string): EnvironmentVariableCategory {
  return value === "build" ? "build" : "runtime";
}

function normalizeSource(value: string): "inline" | "1password" {
  return value === "1password" ? "1password" : "inline";
}

function isSecretVariable(row: { isSecret: string }) {
  return row.isSecret === "true";
}

async function loadEnvironmentScopedVariables(input: {
  teamId: string;
  environmentId?: string;
  limit: number;
}) {
  const filters = [eq(projects.teamId, input.teamId)];
  if (input.environmentId) {
    filters.push(eq(environmentVariables.environmentId, input.environmentId));
  }

  const rows = await db
    .select({
      variable: environmentVariables,
      environment: environments,
      project: projects,
      updatedByUser: users
    })
    .from(environmentVariables)
    .innerJoin(environments, eq(environments.id, environmentVariables.environmentId))
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .leftJoin(users, eq(users.id, environmentVariables.updatedByUserId))
    .where(and(...filters))
    .orderBy(desc(environmentVariables.createdAt))
    .limit(input.limit);

  return rows.map(
    ({ variable, environment, project, updatedByUser }) =>
      ({
        id: getEnvironmentVariableId(variable),
        scope: "environment",
        environmentId: variable.environmentId,
        environmentName: environment.name,
        projectName: project.name,
        serviceId: null,
        serviceName: null,
        key: variable.key,
        value: decrypt(variable.valueEncrypted),
        isSecret: isSecretVariable(variable),
        category: normalizeCategory(variable.category),
        source: normalizeSource(variable.source),
        secretRef: variable.secretRef,
        branchPattern: normalizeStoredBranchPattern(variable.branchPattern),
        updatedByEmail: updatedByUser?.email ?? "",
        updatedAt: variable.updatedAt.toISOString()
      }) satisfies LayeredEnvironmentVariableRecord
  );
}

async function loadServiceScopedVariables(input: {
  teamId: string;
  environmentId?: string;
  serviceId?: string;
  limit: number;
}) {
  if (!input.serviceId && !input.environmentId) {
    return [] satisfies LayeredEnvironmentVariableRecord[];
  }

  const filters = [eq(projects.teamId, input.teamId)];
  if (input.serviceId) {
    filters.push(eq(serviceVariables.serviceId, input.serviceId));
  }
  if (input.environmentId) {
    filters.push(eq(services.environmentId, input.environmentId));
  }

  const rows = await db
    .select({
      variable: serviceVariables,
      service: services,
      environment: environments,
      project: projects,
      updatedByUser: users
    })
    .from(serviceVariables)
    .innerJoin(services, eq(services.id, serviceVariables.serviceId))
    .innerJoin(environments, eq(environments.id, services.environmentId))
    .innerJoin(projects, eq(projects.id, services.projectId))
    .leftJoin(users, eq(users.id, serviceVariables.updatedByUserId))
    .where(and(...filters))
    .orderBy(desc(serviceVariables.createdAt))
    .limit(input.limit);

  return rows.map(
    ({ variable, service, environment, project, updatedByUser }) =>
      ({
        id: getServiceVariableId(variable),
        scope: "service",
        environmentId: service.environmentId,
        environmentName: environment.name,
        projectName: project.name,
        serviceId: service.id,
        serviceName: service.name,
        key: variable.key,
        value: decrypt(variable.valueEncrypted),
        isSecret: isSecretVariable(variable),
        category: normalizeCategory(variable.category),
        source: normalizeSource(variable.source),
        secretRef: variable.secretRef,
        branchPattern: normalizeStoredBranchPattern(variable.branchPattern),
        updatedByEmail: updatedByUser?.email ?? "",
        updatedAt: variable.updatedAt.toISOString()
      }) satisfies LayeredEnvironmentVariableRecord
  );
}

export async function listEnvironmentVariableInventory(input: {
  teamId: string;
  environmentId?: string;
  serviceId?: string;
  branch?: string;
  limit?: number;
  canRevealSecrets?: boolean;
}) {
  const limit = input.limit ?? 50;
  const [environmentRows, serviceRows] = await Promise.all([
    loadEnvironmentScopedVariables({
      teamId: input.teamId,
      environmentId: input.environmentId,
      limit
    }),
    loadServiceScopedVariables({
      teamId: input.teamId,
      environmentId: input.environmentId,
      serviceId: input.serviceId,
      limit
    })
  ]);

  const records = sortLayeredEnvironmentVariables([...environmentRows, ...serviceRows]);
  const canRevealSecrets = input.canRevealSecrets ?? false;
  const resolvedVariables =
    input.environmentId && records.length > 0
      ? resolveEffectiveEnvironmentVariables({
          records,
          branch: input.branch,
          canRevealSecrets
        })
      : [];

  return {
    summary: {
      totalVariables: records.length,
      secretVariables: records.filter((record) => record.isSecret).length,
      runtimeVariables: records.filter((record) => record.category === "runtime").length,
      buildVariables: records.filter((record) => record.category === "build").length,
      serviceOverrides: records.filter((record) => record.scope === "service").length,
      previewOverrides: records.filter((record) => record.branchPattern.length > 0).length,
      resolvedVariables: resolvedVariables.length
    },
    variables: records.map((record) =>
      toEnvironmentVariableInventoryRecord(record, canRevealSecrets)
    ),
    resolvedVariables
  };
}
