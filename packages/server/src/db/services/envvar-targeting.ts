import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { environmentVariables, environments, projects, projectVariables } from "../schema/projects";
import { serviceVariables, services } from "../schema/services";
import { readBranchPattern } from "./envvar-layering";
import { resolveTeamIdForUser } from "./teams";

export type EnvironmentVariableRow = typeof environmentVariables.$inferSelect;
export type ProjectVariableRow = typeof projectVariables.$inferSelect;
export type ServiceVariableRow = typeof serviceVariables.$inferSelect;

interface ScopedProjectRecord {
  scope: "project";
  teamId: string;
  projectId: string;
  projectName: string;
  environmentId: null;
  environmentName: null;
  serviceId: null;
  serviceName: null;
}

interface ScopedEnvironmentRecord {
  scope: "environment";
  teamId: string;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
  serviceId: null;
  serviceName: null;
}

interface ScopedServiceRecord {
  scope: "service";
  teamId: string;
  projectId: string;
  projectName: string;
  environmentId: string;
  environmentName: string;
  serviceId: string;
  serviceName: string;
}

export type ScopedVariableTarget =
  ScopedProjectRecord | ScopedEnvironmentRecord | ScopedServiceRecord;

async function getScopedProjectRecord(projectId: string, teamId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.teamId, teamId)))
    .limit(1);

  if (!project) {
    return null;
  }

  return {
    scope: "project" as const,
    teamId,
    projectId: project.id,
    projectName: project.name,
    environmentId: null,
    environmentName: null,
    serviceId: null,
    serviceName: null
  } satisfies ScopedProjectRecord;
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

  if (!row) {
    return null;
  }

  return {
    scope: "environment" as const,
    teamId,
    projectId: row.project.id,
    projectName: row.project.name,
    environmentId: row.environment.id,
    environmentName: row.environment.name,
    serviceId: null,
    serviceName: null
  } satisfies ScopedEnvironmentRecord;
}

async function getScopedServiceRecord(serviceId: string, teamId: string) {
  const [row] = await db
    .select({
      service: services,
      environment: environments,
      project: projects
    })
    .from(services)
    .innerJoin(environments, eq(environments.id, services.environmentId))
    .innerJoin(projects, eq(projects.id, services.projectId))
    .where(and(eq(services.id, serviceId), eq(projects.teamId, teamId)))
    .limit(1);

  if (!row) {
    return null;
  }

  return {
    scope: "service" as const,
    teamId,
    projectId: row.project.id,
    projectName: row.project.name,
    environmentId: row.environment.id,
    environmentName: row.environment.name,
    serviceId: row.service.id,
    serviceName: row.service.name
  } satisfies ScopedServiceRecord;
}

export async function resolveScopedVariableTarget(input: {
  projectId?: string | null;
  environmentId?: string | null;
  serviceId?: string | null;
  scope: "project" | "environment" | "service";
  actorUserId: string;
  teamId?: string;
}) {
  const teamId = input.teamId ?? (await resolveTeamIdForUser(input.actorUserId));
  if (!teamId) {
    return null;
  }

  if (input.scope === "project") {
    return input.projectId ? getScopedProjectRecord(input.projectId, teamId) : null;
  }

  if (input.scope === "service") {
    if (!input.serviceId || !input.environmentId) {
      return null;
    }

    const service = await getScopedServiceRecord(input.serviceId, teamId);
    if (!service || service.environmentId !== input.environmentId) {
      return null;
    }

    return service;
  }

  return input.environmentId ? getScopedEnvironmentRecord(input.environmentId, teamId) : null;
}

export function buildVariableTargetResource(input: {
  scope: "project" | "environment" | "service";
  projectId: string;
  environmentId: string | null;
  serviceId: string | null;
  key: string;
  branchPattern: string;
}) {
  const selector =
    input.branchPattern.length > 0
      ? `${input.key}@${encodeURIComponent(input.branchPattern)}`
      : input.key;

  if (input.scope === "project") {
    return `env-var/project/${input.projectId}/${selector}`;
  }

  if (input.scope === "service" && input.serviceId) {
    return `env-var/service/${input.serviceId}/${selector}`;
  }

  return `env-var/environment/${input.environmentId}/${selector}`;
}

export function buildVariableTargetLabel(target: ScopedVariableTarget) {
  if (target.scope === "project") {
    return target.projectName;
  }

  return target.scope === "service"
    ? `${target.environmentName} / ${target.serviceName}`
    : target.environmentName;
}

export function buildVariableResourceMetadata(input: {
  target: ScopedVariableTarget;
  key: string;
  branchPattern: string;
}) {
  const branchPattern = readBranchPattern(input.branchPattern);
  const targetId =
    input.target.scope === "project"
      ? input.target.projectId
      : input.target.scope === "service"
        ? input.target.serviceId
        : input.target.environmentId;
  const resourceId = `${targetId}/${input.key}${branchPattern ? `@${branchPattern}` : ""}`;

  return {
    resourceType: "env-var",
    resourceId,
    resourceLabel: `${input.key}@${buildVariableTargetLabel(input.target)}`,
    scope: input.target.scope,
    projectId: input.target.projectId,
    projectName: input.target.projectName,
    environmentId: input.target.environmentId,
    environmentName: input.target.environmentName,
    serviceId: input.target.serviceId,
    serviceName: input.target.serviceName,
    branchPattern
  };
}

export async function findExistingScopedVariable(input: {
  target: ScopedVariableTarget;
  key: string;
  branchPattern: string;
}) {
  if (input.target.scope === "project") {
    const [row] = await db
      .select()
      .from(projectVariables)
      .where(
        and(
          eq(projectVariables.projectId, input.target.projectId),
          eq(projectVariables.key, input.key)
        )
      )
      .limit(1);

    return row ?? null;
  }

  if (input.target.scope === "service" && input.target.serviceId) {
    const [row] = await db
      .select()
      .from(serviceVariables)
      .where(
        and(
          eq(serviceVariables.serviceId, input.target.serviceId),
          eq(serviceVariables.key, input.key),
          eq(serviceVariables.branchPattern, input.branchPattern)
        )
      )
      .limit(1);

    return row ?? null;
  }

  const [row] = await db
    .select()
    .from(environmentVariables)
    .where(
      and(
        eq(environmentVariables.environmentId, input.target.environmentId),
        eq(environmentVariables.key, input.key),
        eq(environmentVariables.branchPattern, input.branchPattern)
      )
    )
    .limit(1);

  return row ?? null;
}
