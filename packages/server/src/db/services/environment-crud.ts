import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { environmentVariables, environments, projects } from "../schema/projects";
import { services } from "../schema/services";
import { newId as id } from "./json-helpers";
import { mapEnvironmentSummary } from "./project-record-views";
import { findScopedEnvironment, findScopedProject } from "./project-scoped-queries";
import { toSlug } from "./project-service-helpers";
import type {
  CreateEnvironmentInput,
  DeleteEnvironmentInput,
  UpdateEnvironmentInput
} from "./project-service-types";
import { writeComposeSourceSelectionToConfig } from "../../compose-source";

export async function createEnvironment(input: CreateEnvironmentInput) {
  const project = input.teamId
    ? await findScopedProject(input.projectId, input.teamId)
    : ((await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1))[0] ??
      null);
  if (!project) return { status: "not_found" as const, entity: "project" };

  const slug = toSlug(input.name);
  const [bySlug] = await db
    .select({ id: environments.id })
    .from(environments)
    .where(and(eq(environments.projectId, input.projectId), eq(environments.slug, slug)))
    .limit(1);
  if (bySlug) return { status: "conflict" as const, conflictField: "name" };

  const environmentConfig = writeComposeSourceSelectionToConfig({
    config: {
      targetServerId: input.targetServerId ?? null
    },
    composeFiles: input.composeFiles,
    composeProfiles: input.composeProfiles
  });
  const environmentId = id();
  const [environment] = await db
    .insert(environments)
    .values({
      id: environmentId,
      projectId: input.projectId,
      name: input.name,
      slug,
      status: "active",
      config: environmentConfig,
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
    inputSummary: `Created environment "${input.name}" in project "${project.name}"`,
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
  const existing = input.teamId
    ? await findScopedEnvironment(input.environmentId, input.teamId)
    : ((
        await db
          .select({
            environment: environments,
            project: projects
          })
          .from(environments)
          .innerJoin(projects, eq(projects.id, environments.projectId))
          .where(eq(environments.id, input.environmentId))
          .limit(1)
      )[0] ?? null);
  if (!existing) return { status: "not_found" as const };

  if (input.name) {
    const nextSlug = toSlug(input.name);
    const [bySlug] = await db
      .select({ id: environments.id })
      .from(environments)
      .where(and(eq(environments.projectId, existing.project.id), eq(environments.slug, nextSlug)))
      .limit(1);

    if (bySlug && bySlug.id !== input.environmentId) {
      return { status: "conflict" as const, conflictField: "name" };
    }
  }

  const updates: Partial<typeof environments.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    updates.name = input.name;
    updates.slug = toSlug(input.name);
  }
  if (input.status !== undefined) updates.status = input.status;
  if (
    input.targetServerId !== undefined ||
    input.composeFiles !== undefined ||
    input.composeProfiles !== undefined
  ) {
    const existingConfig =
      existing.environment.config && typeof existing.environment.config === "object"
        ? (existing.environment.config as Record<string, unknown>)
        : {};
    updates.config = writeComposeSourceSelectionToConfig({
      config:
        input.targetServerId !== undefined
          ? { ...existingConfig, targetServerId: input.targetServerId || null }
          : existingConfig,
      composeFiles: input.composeFiles,
      composeProfiles: input.composeProfiles
    });
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
  const existing = input.teamId
    ? await findScopedEnvironment(input.environmentId, input.teamId)
    : ((
        await db
          .select({
            environment: environments,
            project: projects
          })
          .from(environments)
          .innerJoin(projects, eq(projects.id, environments.projectId))
          .where(eq(environments.id, input.environmentId))
          .limit(1)
      )[0] ?? null);
  if (!existing) return { status: "not_found" as const };

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
    inputSummary: `Deleted environment "${existing.environment.name}"`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: { resourceType: "environment", resourceId: input.environmentId }
  });

  return { status: "ok" as const };
}

export async function listEnvironments(projectId: string, teamId?: string) {
  const project = teamId
    ? await findScopedProject(projectId, teamId)
    : ((await db.select().from(projects).where(eq(projects.id, projectId)).limit(1))[0] ?? null);
  if (!project) return [];

  const [envRows, serviceRows] = await Promise.all([
    db
      .select()
      .from(environments)
      .where(eq(environments.projectId, projectId))
      .orderBy(desc(environments.createdAt)),
    db
      .select({ id: services.id, environmentId: services.environmentId })
      .from(services)
      .innerJoin(projects, eq(projects.id, services.projectId))
      .where(
        teamId
          ? and(eq(services.projectId, projectId), eq(projects.teamId, teamId))
          : eq(services.projectId, projectId)
      )
  ]);

  const serviceCountByEnvironment = new Map<string, number>();
  for (const service of serviceRows) {
    serviceCountByEnvironment.set(
      service.environmentId,
      (serviceCountByEnvironment.get(service.environmentId) ?? 0) + 1
    );
  }

  return envRows.map((environment) =>
    mapEnvironmentSummary(environment, serviceCountByEnvironment.get(environment.id) ?? 0)
  );
}
