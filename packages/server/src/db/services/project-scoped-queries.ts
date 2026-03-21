import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { environments, projects } from "../schema/projects";

export async function findScopedProject(projectId: string, teamId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.teamId, teamId)))
    .limit(1);

  return project ?? null;
}

export async function findScopedEnvironment(environmentId: string, teamId: string) {
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
