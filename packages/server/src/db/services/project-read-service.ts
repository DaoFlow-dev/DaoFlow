import { desc, eq, inArray } from "drizzle-orm";
import { db } from "../connection";
import { environments, projects } from "../schema/projects";
import { services } from "../schema/services";
import { mapEnvironmentSummary, mapProjectSummary } from "./project-record-views";
import { readProjectSourceReadiness } from "./project-source-readiness";
import { findScopedProject } from "./project-scoped-queries";

export async function listProjects(teamId?: string, limit = 50) {
  const rows = teamId
    ? await db
        .select()
        .from(projects)
        .where(eq(projects.teamId, teamId))
        .orderBy(desc(projects.createdAt))
        .limit(limit)
    : await db.select().from(projects).orderBy(desc(projects.createdAt)).limit(limit);

  if (rows.length === 0) {
    return [];
  }

  const projectIds = rows.map((project) => project.id);
  const [envRows, serviceRows] = await Promise.all([
    db
      .select({ id: environments.id, projectId: environments.projectId })
      .from(environments)
      .where(inArray(environments.projectId, projectIds)),
    db
      .select({ id: services.id, projectId: services.projectId })
      .from(services)
      .where(inArray(services.projectId, projectIds))
  ]);

  const environmentCountByProject = new Map<string, number>();
  for (const environment of envRows) {
    environmentCountByProject.set(
      environment.projectId,
      (environmentCountByProject.get(environment.projectId) ?? 0) + 1
    );
  }

  const serviceCountByProject = new Map<string, number>();
  for (const service of serviceRows) {
    serviceCountByProject.set(
      service.projectId,
      (serviceCountByProject.get(service.projectId) ?? 0) + 1
    );
  }

  return rows.map((project) =>
    mapProjectSummary(
      project,
      {
        environmentCount: environmentCountByProject.get(project.id) ?? 0,
        serviceCount: serviceCountByProject.get(project.id) ?? 0
      },
      readProjectSourceReadiness(project.config)
    )
  );
}

export async function getProject(projectId: string, teamId?: string) {
  const project = teamId
    ? await findScopedProject(projectId, teamId)
    : ((await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0] ?? null);
  if (!project) return null;

  const [envRows, serviceRows] = await Promise.all([
    db
      .select()
      .from(environments)
      .where(eq(environments.projectId, projectId))
      .orderBy(desc(environments.createdAt)),
    db
      .select({ id: services.id, environmentId: services.environmentId })
      .from(services)
      .where(eq(services.projectId, projectId))
  ]);

  const serviceCountByEnvironment = new Map<string, number>();
  for (const service of serviceRows) {
    serviceCountByEnvironment.set(
      service.environmentId,
      (serviceCountByEnvironment.get(service.environmentId) ?? 0) + 1
    );
  }

  return {
    ...mapProjectSummary(
      project,
      {
        environmentCount: envRows.length,
        serviceCount: serviceRows.length
      },
      readProjectSourceReadiness(project.config)
    ),
    environments: envRows.map((environment) =>
      mapEnvironmentSummary(environment, serviceCountByEnvironment.get(environment.id) ?? 0)
    )
  };
}
