import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { projects, environments, environmentVariables } from "../schema/projects";
import type { AppRole } from "@daoflow/shared";
import { newId as id } from "./json-helpers";

/* ──────────────────────── Interfaces ──────────────────────── */

export interface CreateProjectInput {
  name: string;
  description?: string;
  repoUrl?: string;
  defaultBranch?: string;
  teamId: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

/** Converts a name to a URL-safe slug. */
function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

export interface UpdateProjectInput {
  projectId: string;
  name?: string;
  description?: string;
  repoUrl?: string;
  defaultBranch?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface DeleteProjectInput {
  projectId: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface CreateEnvironmentInput {
  projectId: string;
  name: string;
  targetServerId?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface UpdateEnvironmentInput {
  environmentId: string;
  name?: string;
  status?: string;
  targetServerId?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface DeleteEnvironmentInput {
  environmentId: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

/* ──────────────────────── Project CRUD ──────────────────────── */

export async function createProject(input: CreateProjectInput) {
  const byName = await db.select().from(projects).where(eq(projects.name, input.name)).limit(1);
  if (byName[0]) return { status: "conflict" as const, conflictField: "name" };

  const projectId = id();
  const [project] = await db
    .insert(projects)
    .values({
      id: projectId,
      name: input.name,
      slug: toSlug(input.name),
      teamId: input.teamId,
      repoUrl: input.repoUrl ?? null,
      sourceType: "compose",
      createdByUserId: input.requestedByUserId,
      config: {
        description: input.description ?? "",
        defaultBranch: input.defaultBranch ?? "main",
        latestDeploymentStatus: "new"
      },
      updatedAt: new Date()
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `project/${projectId}`,
    action: "project.create",
    inputSummary: `Created project "${input.name}"`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: { resourceType: "project", resourceId: projectId, resourceLabel: input.name }
  });

  return { status: "ok" as const, project };
}

export async function updateProject(input: UpdateProjectInput) {
  const existing = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!existing[0]) return { status: "not_found" as const };

  if (input.name) {
    const byName = await db.select().from(projects).where(eq(projects.name, input.name)).limit(1);
    if (byName[0] && byName[0].id !== input.projectId) {
      return { status: "conflict" as const, conflictField: "name" };
    }
  }

  const updates: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.repoUrl !== undefined) updates.repoUrl = input.repoUrl;
  if (input.description !== undefined || input.defaultBranch !== undefined) {
    const existingConfig =
      existing[0].config && typeof existing[0].config === "object" ? existing[0].config : {};
    updates.config = {
      ...existingConfig,
      ...(input.description !== undefined ? { description: input.description } : {}),
      ...(input.defaultBranch !== undefined ? { defaultBranch: input.defaultBranch } : {})
    };
  }

  const [project] = await db
    .update(projects)
    .set(updates)
    .where(eq(projects.id, input.projectId))
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `project/${input.projectId}`,
    action: "project.update",
    inputSummary: `Updated project "${project.name}"`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: { resourceType: "project", resourceId: input.projectId }
  });

  return { status: "ok" as const, project };
}

export async function deleteProject(input: DeleteProjectInput) {
  const existing = await db
    .select()
    .from(projects)
    .where(eq(projects.id, input.projectId))
    .limit(1);
  if (!existing[0]) return { status: "not_found" as const };

  // Delete child environment variables and environments first
  const envRows = await db
    .select()
    .from(environments)
    .where(eq(environments.projectId, input.projectId));

  for (const env of envRows) {
    await db.delete(environmentVariables).where(eq(environmentVariables.environmentId, env.id));
  }
  await db.delete(environments).where(eq(environments.projectId, input.projectId));
  await db.delete(projects).where(eq(projects.id, input.projectId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `project/${input.projectId}`,
    action: "project.delete",
    inputSummary: `Deleted project "${existing[0].name}"`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: { resourceType: "project", resourceId: input.projectId }
  });

  return { status: "ok" as const };
}

export async function listProjects(limit = 50) {
  return db.select().from(projects).orderBy(desc(projects.createdAt)).limit(limit);
}

export async function getProject(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;

  const envRows = await db
    .select()
    .from(environments)
    .where(eq(environments.projectId, projectId))
    .orderBy(desc(environments.createdAt));

  return { ...project, environments: envRows };
}

/* ──────────────────────── Environment CRUD ──────────────────────── */

export async function createEnvironment(input: CreateEnvironmentInput) {
  const project = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project[0]) return { status: "not_found" as const, entity: "project" };

  const environmentId = id();
  const [environment] = await db
    .insert(environments)
    .values({
      id: environmentId,
      projectId: input.projectId,
      name: input.name,
      slug: toSlug(input.name),
      status: "active",
      config: {
        targetServerId: input.targetServerId ?? null
      },
      updatedAt: new Date()
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `environment/${environmentId}`,
    action: "environment.create",
    inputSummary: `Created environment "${input.name}" in project "${project[0].name}"`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: {
      resourceType: "environment",
      resourceId: environmentId,
      projectId: input.projectId
    }
  });

  return { status: "ok" as const, environment };
}

export async function updateEnvironment(input: UpdateEnvironmentInput) {
  const existing = await db
    .select()
    .from(environments)
    .where(eq(environments.id, input.environmentId))
    .limit(1);
  if (!existing[0]) return { status: "not_found" as const };

  const updates: Partial<typeof environments.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) updates.name = input.name;
  if (input.status !== undefined) updates.status = input.status;
  if (input.targetServerId !== undefined) {
    const existingConfig =
      existing[0].config && typeof existing[0].config === "object" ? existing[0].config : {};
    updates.config = { ...existingConfig, targetServerId: input.targetServerId };
  }

  const [environment] = await db
    .update(environments)
    .set(updates)
    .where(eq(environments.id, input.environmentId))
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `environment/${input.environmentId}`,
    action: "environment.update",
    inputSummary: `Updated environment "${environment.name}"`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: { resourceType: "environment", resourceId: input.environmentId }
  });

  return { status: "ok" as const, environment };
}

export async function deleteEnvironment(input: DeleteEnvironmentInput) {
  const existing = await db
    .select()
    .from(environments)
    .where(eq(environments.id, input.environmentId))
    .limit(1);
  if (!existing[0]) return { status: "not_found" as const };

  await db
    .delete(environmentVariables)
    .where(eq(environmentVariables.environmentId, input.environmentId));
  await db.delete(environments).where(eq(environments.id, input.environmentId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `environment/${input.environmentId}`,
    action: "environment.delete",
    inputSummary: `Deleted environment "${existing[0].name}"`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: { resourceType: "environment", resourceId: input.environmentId }
  });

  return { status: "ok" as const };
}

export async function listEnvironments(projectId: string) {
  return db
    .select()
    .from(environments)
    .where(eq(environments.projectId, projectId))
    .orderBy(desc(environments.createdAt));
}
