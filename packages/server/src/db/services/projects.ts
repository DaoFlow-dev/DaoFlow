import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { projects, environments, environmentVariables } from "../schema/projects";
import { services } from "../schema/services";
import type { AppRole } from "@daoflow/shared";
import { normalizeInventoryStatus } from "@daoflow/shared";
import { asRecord, newId as id } from "./json-helpers";
import {
  normalizeComposeFilePaths,
  normalizeComposeProfiles,
  writeComposeSourceSelectionToConfig
} from "../../compose-source";
import { writeWebhookAutoDeployConfigToConfig } from "../../webhook-auto-deploy";
import {
  mergeProjectSourceReadiness,
  readProjectSourceReadiness,
  validateProjectSourceReadiness
} from "./project-source-readiness";
import { mergeRepositoryPreparationConfig } from "../../repository-preparation";

/* ──────────────────────── Interfaces ──────────────────────── */

export interface CreateProjectInput {
  name: string;
  description?: string;
  repoUrl?: string;
  repoFullName?: string;
  composePath?: string;
  composeFiles?: string[];
  composeProfiles?: string[];
  gitProviderId?: string;
  gitInstallationId?: string;
  defaultBranch?: string;
  autoDeploy?: boolean;
  autoDeployBranch?: string;
  webhookWatchedPaths?: string[];
  repositorySubmodules?: boolean;
  repositoryGitLfs?: boolean;
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
  teamId?: string;
  name?: string;
  description?: string;
  repoUrl?: string;
  repoFullName?: string;
  composePath?: string;
  composeFiles?: string[];
  composeProfiles?: string[];
  gitProviderId?: string;
  gitInstallationId?: string;
  defaultBranch?: string;
  autoDeploy?: boolean;
  autoDeployBranch?: string;
  webhookWatchedPaths?: string[];
  repositorySubmodules?: boolean;
  repositoryGitLfs?: boolean;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface DeleteProjectInput {
  projectId: string;
  teamId?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface CreateEnvironmentInput {
  projectId: string;
  teamId?: string;
  name: string;
  targetServerId?: string;
  composeFiles?: string[];
  composeProfiles?: string[];
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface UpdateEnvironmentInput {
  environmentId: string;
  teamId?: string;
  name?: string;
  status?: string;
  targetServerId?: string;
  composeFiles?: string[];
  composeProfiles?: string[];
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface DeleteEnvironmentInput {
  environmentId: string;
  teamId?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readConfigString(config: unknown, key: string): string | null {
  const value = asRecord(config)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readConfigStringArray(config: unknown, key: string): string[] {
  return readStringArray(asRecord(config)[key]);
}

function mapEnvironmentSummary(
  environment: typeof environments.$inferSelect,
  serviceCount: number
) {
  return {
    ...environment,
    targetServerId: readConfigString(environment.config, "targetServerId"),
    composeFiles: readConfigStringArray(environment.config, "composeFilePaths"),
    composeProfiles: readConfigStringArray(environment.config, "composeProfiles"),
    serviceCount,
    statusTone: normalizeInventoryStatus(environment.status)
  };
}

function mapProjectSummary(
  project: typeof projects.$inferSelect,
  counts: {
    environmentCount: number;
    serviceCount: number;
  }
) {
  return {
    ...project,
    description: readConfigString(project.config, "description"),
    composeFiles: readConfigStringArray(project.config, "composeFilePaths"),
    composeProfiles: readConfigStringArray(project.config, "composeProfiles"),
    environmentCount: counts.environmentCount,
    serviceCount: counts.serviceCount,
    statusTone: normalizeInventoryStatus(project.status),
    sourceReadiness: readProjectSourceReadiness(project.config)
  };
}

async function findScopedProject(projectId: string, teamId: string) {
  const [project] = await db
    .select()
    .from(projects)
    .where(and(eq(projects.id, projectId), eq(projects.teamId, teamId)))
    .limit(1);

  return project ?? null;
}

async function findScopedEnvironment(environmentId: string, teamId: string) {
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

/* ──────────────────────── Project CRUD ──────────────────────── */

export async function createProject(input: CreateProjectInput) {
  const byName = await db.select().from(projects).where(eq(projects.name, input.name)).limit(1);
  if (byName[0]) return { status: "conflict" as const, conflictField: "name" };

  const composeFiles = normalizeComposeFilePaths({
    composeFiles: input.composeFiles,
    composePath: input.composePath
  });
  const composeProfiles = normalizeComposeProfiles(input.composeProfiles);
  const baseConfig = {
    description: input.description ?? "",
    latestDeploymentStatus: "new"
  };
  const configWithComposeSource = writeComposeSourceSelectionToConfig({
    config: mergeRepositoryPreparationConfig(baseConfig, {
      submodules: input.repositorySubmodules,
      gitLfs: input.repositoryGitLfs
    }),
    composeFiles,
    composeProfiles
  });
  const configWithWebhookAutoDeploy = writeWebhookAutoDeployConfigToConfig({
    config: configWithComposeSource,
    watchedPaths: input.webhookWatchedPaths
  });
  const sourceValidation = await validateProjectSourceReadiness({
    repoUrl: input.repoUrl,
    repoFullName: input.repoFullName,
    gitProviderId: input.gitProviderId,
    gitInstallationId: input.gitInstallationId,
    defaultBranch: input.defaultBranch,
    composePath: composeFiles[0],
    composeFiles,
    composeProfiles,
    repositoryPreparation: asRecord(configWithWebhookAutoDeploy).repositoryPreparation,
    genericGitMode: "best-effort"
  });
  if (sourceValidation.status === "invalid") {
    return {
      status: "invalid_source" as const,
      message: sourceValidation.message
    };
  }
  if (sourceValidation.status === "provider_unavailable") {
    return {
      status: "provider_unavailable" as const,
      message: sourceValidation.message
    };
  }

  const projectId = id();
  const [project] = await db
    .insert(projects)
    .values({
      id: projectId,
      name: input.name,
      slug: toSlug(input.name),
      teamId: input.teamId,
      repoFullName: input.repoFullName ?? null,
      repoUrl: input.repoUrl ?? null,
      sourceType: "compose",
      composePath: composeFiles[0] ?? null,
      gitProviderId: input.gitProviderId ?? null,
      gitInstallationId: input.gitInstallationId ?? null,
      defaultBranch: input.defaultBranch ?? "main",
      autoDeploy: input.autoDeploy ?? false,
      autoDeployBranch: input.autoDeployBranch ?? null,
      createdByUserId: input.requestedByUserId,
      config: mergeProjectSourceReadiness(
        configWithWebhookAutoDeploy,
        sourceValidation.status === "ready" ? sourceValidation.readiness : null
      ),
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
  const existing = input.teamId
    ? await findScopedProject(input.projectId, input.teamId)
    : ((await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1))[0] ??
      null);
  if (!existing) return { status: "not_found" as const };

  if (input.name) {
    const byName = await db.select().from(projects).where(eq(projects.name, input.name)).limit(1);
    if (byName[0] && byName[0].id !== input.projectId) {
      return { status: "conflict" as const, conflictField: "name" };
    }
  }

  const sourceFieldsTouched =
    input.repoUrl !== undefined ||
    input.repoFullName !== undefined ||
    input.gitProviderId !== undefined ||
    input.gitInstallationId !== undefined ||
    input.defaultBranch !== undefined ||
    input.composePath !== undefined ||
    input.composeFiles !== undefined ||
    input.composeProfiles !== undefined;
  const repositoryPreparationTouched =
    input.repositorySubmodules !== undefined || input.repositoryGitLfs !== undefined;
  const webhookAutoDeployTouched =
    input.webhookWatchedPaths !== undefined ||
    input.autoDeploy !== undefined ||
    input.autoDeployBranch !== undefined;
  const existingConfig = asRecord(existing.config);
  const composeFiles = normalizeComposeFilePaths({
    composeFiles:
      input.composeFiles !== undefined
        ? input.composeFiles
        : input.composePath !== undefined
          ? undefined
          : Array.isArray(existingConfig.composeFilePaths)
            ? existingConfig.composeFilePaths.filter(
                (entry): entry is string => typeof entry === "string"
              )
            : undefined,
    composePath: input.composePath ?? existing.composePath
  });
  const composeProfiles =
    input.composeProfiles !== undefined
      ? normalizeComposeProfiles(input.composeProfiles)
      : Array.isArray(existingConfig.composeProfiles)
        ? normalizeComposeProfiles(
            existingConfig.composeProfiles.filter(
              (entry): entry is string => typeof entry === "string"
            )
          )
        : [];
  const nextConfig =
    input.description !== undefined
      ? {
          ...existingConfig,
          description: input.description
        }
      : existingConfig;
  const nextConfigWithComposeSource = writeComposeSourceSelectionToConfig({
    config: mergeRepositoryPreparationConfig(nextConfig, {
      submodules: input.repositorySubmodules,
      gitLfs: input.repositoryGitLfs
    }),
    composeFiles,
    composeProfiles
  });
  const nextConfigWithWebhookAutoDeploy = writeWebhookAutoDeployConfigToConfig({
    config: nextConfigWithComposeSource,
    watchedPaths: input.webhookWatchedPaths !== undefined ? input.webhookWatchedPaths : undefined
  });

  const sourceValidation = sourceFieldsTouched
    ? await validateProjectSourceReadiness({
        repoUrl: input.repoUrl ?? existing.repoUrl,
        repoFullName: input.repoFullName ?? existing.repoFullName,
        gitProviderId: input.gitProviderId ?? existing.gitProviderId,
        gitInstallationId: input.gitInstallationId ?? existing.gitInstallationId,
        defaultBranch: input.defaultBranch ?? existing.defaultBranch,
        composePath: composeFiles[0] ?? existing.composePath,
        composeFiles,
        composeProfiles,
        repositoryPreparation: asRecord(nextConfigWithWebhookAutoDeploy).repositoryPreparation,
        genericGitMode: "best-effort"
      })
    : null;

  if (sourceValidation?.status === "invalid") {
    return {
      status: "invalid_source" as const,
      message: sourceValidation.message
    };
  }
  if (sourceValidation?.status === "provider_unavailable") {
    return {
      status: "provider_unavailable" as const,
      message: sourceValidation.message
    };
  }

  const updates: Partial<typeof projects.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    updates.name = input.name;
    updates.slug = toSlug(input.name);
  }
  if (input.repoUrl !== undefined) updates.repoUrl = input.repoUrl;
  if (input.repoFullName !== undefined) updates.repoFullName = input.repoFullName;
  if (
    input.composePath !== undefined ||
    input.composeFiles !== undefined ||
    input.composeProfiles !== undefined
  ) {
    updates.composePath = composeFiles[0] ?? existing.composePath;
  }
  if (input.gitProviderId !== undefined) updates.gitProviderId = input.gitProviderId ?? null;
  if (input.gitInstallationId !== undefined) {
    updates.gitInstallationId = input.gitInstallationId ?? null;
  }
  if (input.defaultBranch !== undefined) updates.defaultBranch = input.defaultBranch ?? null;
  if (input.autoDeploy !== undefined) updates.autoDeploy = input.autoDeploy;
  if (input.autoDeployBranch !== undefined) {
    updates.autoDeployBranch = input.autoDeployBranch ?? null;
  }
  if (
    input.description !== undefined ||
    sourceFieldsTouched ||
    repositoryPreparationTouched ||
    webhookAutoDeployTouched
  ) {
    updates.config = mergeProjectSourceReadiness(
      nextConfigWithWebhookAutoDeploy,
      sourceValidation?.status === "ready"
        ? sourceValidation.readiness
        : sourceFieldsTouched
          ? null
          : readProjectSourceReadiness(existing.config)
    );
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
  const existing = input.teamId
    ? await findScopedProject(input.projectId, input.teamId)
    : ((await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1))[0] ??
      null);
  if (!existing) return { status: "not_found" as const };

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
    inputSummary: `Deleted project "${existing.name}"`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: { resourceType: "project", resourceId: input.projectId }
  });

  return { status: "ok" as const };
}

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
    mapProjectSummary(project, {
      environmentCount: environmentCountByProject.get(project.id) ?? 0,
      serviceCount: serviceCountByProject.get(project.id) ?? 0
    })
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
    ...mapProjectSummary(project, {
      environmentCount: envRows.length,
      serviceCount: serviceRows.length
    }),
    environments: envRows.map((environment) =>
      mapEnvironmentSummary(environment, serviceCountByEnvironment.get(environment.id) ?? 0)
    )
  };
}

/* ──────────────────────── Environment CRUD ──────────────────────── */

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
