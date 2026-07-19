import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { decrypt } from "../crypto";
import { previewEnvironments } from "../schema/preview-environments";
import { environmentVariables, environments, projects, projectVariables } from "../schema/projects";
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

function getProjectVariableId(row: typeof projectVariables.$inferSelect) {
  return `projvar_${row.id}`;
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

function isSecretVariable(row: { isSecret: string; source: string }) {
  return row.isSecret === "true" || row.source === "1password";
}

function emptyEnvironmentVariableInventory() {
  return {
    summary: {
      totalVariables: 0,
      projectDefaults: 0,
      secretVariables: 0,
      runtimeVariables: 0,
      buildVariables: 0,
      serviceOverrides: 0,
      previewOverrides: 0,
      resolvedVariables: 0
    },
    variables: [],
    resolvedVariables: [],
    previewEnvironment: null
  };
}

async function findInventoryContext(input: {
  teamId: string;
  projectId?: string;
  environmentId?: string;
  serviceId?: string;
}) {
  if (input.serviceId) {
    const [row] = await db
      .select({ service: services, environment: environments, project: projects })
      .from(services)
      .innerJoin(environments, eq(environments.id, services.environmentId))
      .innerJoin(projects, eq(projects.id, services.projectId))
      .where(and(eq(services.id, input.serviceId), eq(projects.teamId, input.teamId)))
      .limit(1);
    if (!row) return null;
    return {
      projectId: row.project.id,
      environmentId: row.environment.id,
      serviceId: row.service.id
    };
  }

  if (input.environmentId) {
    const [row] = await db
      .select({ environment: environments, project: projects })
      .from(environments)
      .innerJoin(projects, eq(projects.id, environments.projectId))
      .where(and(eq(environments.id, input.environmentId), eq(projects.teamId, input.teamId)))
      .limit(1);
    if (!row) return null;
    return {
      projectId: row.project.id,
      environmentId: row.environment.id,
      serviceId: undefined
    };
  }

  if (input.projectId) {
    const [project] = await db
      .select({ id: projects.id })
      .from(projects)
      .where(and(eq(projects.id, input.projectId), eq(projects.teamId, input.teamId)))
      .limit(1);
    return project
      ? { projectId: project.id, environmentId: undefined, serviceId: undefined }
      : null;
  }

  return null;
}

async function loadProjectScopedVariables(input: {
  teamId: string;
  projectId?: string;
  limit: number;
}) {
  const filters = [eq(projects.teamId, input.teamId)];
  if (input.projectId) {
    filters.push(eq(projectVariables.projectId, input.projectId));
  }

  const rows = await db
    .select({ variable: projectVariables, project: projects, updatedByUser: users })
    .from(projectVariables)
    .innerJoin(projects, eq(projects.id, projectVariables.projectId))
    .leftJoin(users, eq(users.id, projectVariables.updatedByUserId))
    .where(and(...filters))
    .orderBy(desc(projectVariables.createdAt))
    .limit(input.limit);

  return rows.map(
    ({ variable, project, updatedByUser }) =>
      ({
        id: getProjectVariableId(variable),
        scope: "project",
        projectId: project.id,
        projectName: project.name,
        environmentId: null,
        environmentName: null,
        serviceId: null,
        serviceName: null,
        key: variable.key,
        value: decrypt(variable.valueEncrypted),
        isSecret: isSecretVariable(variable),
        category: normalizeCategory(variable.category),
        source: normalizeSource(variable.source),
        secretRef: variable.secretRef,
        branchPattern: "",
        revision: variable.revision,
        updatedByEmail: updatedByUser?.email ?? "",
        updatedAt: variable.updatedAt.toISOString()
      }) satisfies LayeredEnvironmentVariableRecord
  );
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
        projectId: project.id,
        projectName: project.name,
        environmentId: variable.environmentId,
        environmentName: environment.name,
        serviceId: null,
        serviceName: null,
        key: variable.key,
        value: decrypt(variable.valueEncrypted),
        isSecret: isSecretVariable(variable),
        category: normalizeCategory(variable.category),
        source: normalizeSource(variable.source),
        secretRef: variable.secretRef,
        branchPattern: normalizeStoredBranchPattern(variable.branchPattern),
        revision: variable.revision,
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
        projectId: project.id,
        projectName: project.name,
        environmentId: service.environmentId,
        environmentName: environment.name,
        serviceId: service.id,
        serviceName: service.name,
        key: variable.key,
        value: decrypt(variable.valueEncrypted),
        isSecret: isSecretVariable(variable),
        category: normalizeCategory(variable.category),
        source: normalizeSource(variable.source),
        secretRef: variable.secretRef,
        branchPattern: normalizeStoredBranchPattern(variable.branchPattern),
        revision: variable.revision,
        updatedByEmail: updatedByUser?.email ?? "",
        updatedAt: variable.updatedAt.toISOString()
      }) satisfies LayeredEnvironmentVariableRecord
  );
}

export async function listEnvironmentVariableInventory(input: {
  teamId: string;
  projectId?: string;
  environmentId?: string;
  serviceId?: string;
  branch?: string;
  previewEnvironmentId?: string;
  limit?: number;
  canRevealSecrets?: boolean;
}) {
  const limit = input.limit ?? 50;
  const [previewEnvironment] = input.previewEnvironmentId
    ? await db
        .select()
        .from(previewEnvironments)
        .where(
          and(
            eq(previewEnvironments.id, input.previewEnvironmentId),
            eq(previewEnvironments.teamId, input.teamId)
          )
        )
        .limit(1)
    : [];
  const requestedContext = await findInventoryContext({
    teamId: input.teamId,
    projectId: previewEnvironment?.projectId ?? input.projectId,
    environmentId: previewEnvironment?.environmentId ?? input.environmentId,
    serviceId: previewEnvironment?.serviceId ?? input.serviceId
  });
  const hasExplicitTarget = Boolean(
    input.projectId || input.environmentId || input.serviceId || input.previewEnvironmentId
  );
  if (hasExplicitTarget && !requestedContext) {
    return emptyEnvironmentVariableInventory();
  }
  const projectId = requestedContext?.projectId;
  const environmentId = requestedContext?.environmentId;
  const serviceId = requestedContext?.serviceId;
  const branch = previewEnvironment?.envBranch ?? input.branch;
  const projectOnly = Boolean(input.projectId && !input.environmentId && !input.serviceId);
  const [projectRows, environmentRows, serviceRows] = await Promise.all([
    loadProjectScopedVariables({ teamId: input.teamId, projectId, limit }),
    projectOnly
      ? Promise.resolve([] satisfies LayeredEnvironmentVariableRecord[])
      : loadEnvironmentScopedVariables({
          teamId: input.teamId,
          environmentId,
          limit
        }),
    projectOnly
      ? Promise.resolve([] satisfies LayeredEnvironmentVariableRecord[])
      : loadServiceScopedVariables({
          teamId: input.teamId,
          environmentId,
          serviceId,
          limit
        })
  ]);

  const records = sortLayeredEnvironmentVariables([
    ...projectRows,
    ...environmentRows,
    ...serviceRows
  ]);
  const canRevealSecrets = input.canRevealSecrets ?? false;
  const resolvedVariables = projectId
    ? resolveEffectiveEnvironmentVariables({ records, branch, canRevealSecrets })
    : [];

  return {
    summary: {
      totalVariables: records.length,
      projectDefaults: records.filter((record) => record.scope === "project").length,
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
    resolvedVariables,
    previewEnvironment: previewEnvironment
      ? {
          id: previewEnvironment.id,
          previewKey: previewEnvironment.previewKey,
          branch: previewEnvironment.branch,
          envBranch: previewEnvironment.envBranch,
          status: previewEnvironment.status
        }
      : null
  };
}
