import { and, desc, eq } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { environments, projects } from "../schema/projects";
import { services } from "../schema/services";
import { buildServiceReadIndex, buildServiceReadModel } from "./service-record-views";

export type ServiceAccessActor = {
  id: string;
  email: string;
  role: AppRole;
  actorType?: string;
};

type DeniedServiceAccessInput = {
  serviceId?: string;
  projectId?: string;
  environmentId?: string;
  actor: ServiceAccessActor;
  action: string;
  permissionScope: string;
};

export async function recordDeniedServiceAccess(input: DeniedServiceAccessInput) {
  await db.insert(auditEntries).values({
    actorType: input.actor.actorType ?? "user",
    actorId: input.actor.id,
    actorEmail: input.actor.email,
    actorRole: input.actor.role,
    targetResource: "service/cross-team",
    action: input.action,
    inputSummary: "Denied cross-team service access.",
    permissionScope: input.permissionScope,
    outcome: "denied",
    metadata: {
      resourceType: "service",
      serviceId: input.serviceId ?? null,
      projectId: input.projectId ?? null,
      environmentId: input.environmentId ?? null,
      detail: "Cross-team service access was denied."
    }
  });
}

async function serviceExists(serviceId: string) {
  const [row] = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.id, serviceId))
    .limit(1);
  return Boolean(row);
}

export async function getServiceForTeam(input: {
  serviceId: string;
  teamId: string;
  actor?: ServiceAccessActor;
  action?: string;
  permissionScope?: string;
}) {
  const [row] = await db
    .select({ service: services })
    .from(services)
    .innerJoin(projects, eq(projects.id, services.projectId))
    .where(and(eq(services.id, input.serviceId), eq(projects.teamId, input.teamId)))
    .limit(1);

  if (row) {
    return row.service;
  }

  if (input.actor && (await serviceExists(input.serviceId))) {
    await recordDeniedServiceAccess({
      serviceId: input.serviceId,
      actor: input.actor,
      action: input.action ?? "service.access.denied",
      permissionScope: input.permissionScope ?? "deploy:read"
    });
  }

  return null;
}

export async function getServiceReadModelForTeam(input: {
  serviceId: string;
  teamId: string;
  actor?: ServiceAccessActor;
  action?: string;
  permissionScope?: string;
}) {
  const service = await getServiceForTeam(input);
  if (!service) {
    return null;
  }

  const index = await buildServiceReadIndex([service]);
  return buildServiceReadModel(service, index);
}

export async function listServicesForTeam(input: {
  teamId: string;
  environmentId?: string;
  limit: number;
  actor?: ServiceAccessActor;
}) {
  if (input.environmentId) {
    const [environment] = await db
      .select({ id: environments.id, projectId: environments.projectId, teamId: projects.teamId })
      .from(environments)
      .innerJoin(projects, eq(projects.id, environments.projectId))
      .where(eq(environments.id, input.environmentId))
      .limit(1);

    if (environment && environment.teamId !== input.teamId && input.actor) {
      await recordDeniedServiceAccess({
        environmentId: input.environmentId,
        actor: input.actor,
        action: "service.list.denied",
        permissionScope: "deploy:read"
      });
    }
  }

  const filters = [eq(projects.teamId, input.teamId)];
  if (input.environmentId) {
    filters.push(eq(services.environmentId, input.environmentId));
  }

  const rows = await db
    .select({ service: services })
    .from(services)
    .innerJoin(projects, eq(projects.id, services.projectId))
    .where(and(...filters))
    .orderBy(desc(services.createdAt))
    .limit(input.limit);
  const serviceRows = rows.map((row) => row.service);
  const index = await buildServiceReadIndex(serviceRows);
  return serviceRows.map((row) => buildServiceReadModel(row, index));
}

export async function listServicesByProjectForTeam(input: {
  projectId: string;
  teamId: string;
  actor?: ServiceAccessActor;
}) {
  const [project] = await db
    .select({ id: projects.id, teamId: projects.teamId })
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);

  if (!project) {
    return null;
  }

  if (project.teamId !== input.teamId) {
    if (input.actor) {
      await recordDeniedServiceAccess({
        projectId: input.projectId,
        actor: input.actor,
        action: "service.project-list.denied",
        permissionScope: "deploy:read"
      });
    }
    return null;
  }

  const rows = await db
    .select()
    .from(services)
    .where(eq(services.projectId, input.projectId))
    .orderBy(desc(services.createdAt));
  const index = await buildServiceReadIndex(rows);
  return rows.map((row) => buildServiceReadModel(row, index));
}

export async function environmentBelongsToTeam(environmentId: string, teamId: string) {
  const [row] = await db
    .select({
      environmentId: environments.id,
      projectId: environments.projectId,
      teamId: projects.teamId
    })
    .from(environments)
    .innerJoin(projects, eq(projects.id, environments.projectId))
    .where(eq(environments.id, environmentId))
    .limit(1);

  return row && row.teamId === teamId ? row : null;
}

export async function projectBelongsToTeam(projectId: string, teamId: string) {
  const [row] = await db
    .select({ projectId: projects.id })
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.teamId, teamId)))
    .limit(1);

  return row ?? null;
}
