import { desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { projects, environments, environmentVariables } from "../schema/projects";
import type { AppRole } from "@daoflow/shared";
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
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface CreateEnvironmentInput {
  projectId: string;
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
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
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
  const existingConfig = asRecord(existing[0].config);
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
    composePath: input.composePath ?? existing[0].composePath
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
        repoUrl: input.repoUrl ?? existing[0].repoUrl,
        repoFullName: input.repoFullName ?? existing[0].repoFullName,
        gitProviderId: input.gitProviderId ?? existing[0].gitProviderId,
        gitInstallationId: input.gitInstallationId ?? existing[0].gitInstallationId,
        defaultBranch: input.defaultBranch ?? existing[0].defaultBranch,
        composePath: composeFiles[0] ?? existing[0].composePath,
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
  if (input.name !== undefined) updates.name = input.name;
  if (input.repoUrl !== undefined) updates.repoUrl = input.repoUrl;
  if (input.repoFullName !== undefined) updates.repoFullName = input.repoFullName;
  if (
    input.composePath !== undefined ||
    input.composeFiles !== undefined ||
    input.composeProfiles !== undefined
  ) {
    updates.composePath = composeFiles[0] ?? existing[0].composePath;
  }
  if (input.gitProviderId !== undefined) updates.gitProviderId = input.gitProviderId;
  if (input.gitInstallationId !== undefined) updates.gitInstallationId = input.gitInstallationId;
  if (input.defaultBranch !== undefined) updates.defaultBranch = input.defaultBranch;
  if (input.autoDeploy !== undefined) updates.autoDeploy = input.autoDeploy;
  if (input.autoDeployBranch !== undefined) updates.autoDeployBranch = input.autoDeployBranch;
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
          : readProjectSourceReadiness(existing[0].config)
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
  const rows = await db.select().from(projects).orderBy(desc(projects.createdAt)).limit(limit);
  return rows.map((project) => ({
    ...project,
    sourceReadiness: readProjectSourceReadiness(project.config)
  }));
}

export async function getProject(projectId: string) {
  const [project] = await db.select().from(projects).where(eq(projects.id, projectId)).limit(1);
  if (!project) return null;

  const envRows = await db
    .select()
    .from(environments)
    .where(eq(environments.projectId, projectId))
    .orderBy(desc(environments.createdAt));

  return {
    ...project,
    environments: envRows,
    sourceReadiness: readProjectSourceReadiness(project.config)
  };
}

/* ──────────────────────── Environment CRUD ──────────────────────── */

export async function createEnvironment(input: CreateEnvironmentInput) {
  const project = await db.select().from(projects).where(eq(projects.id, input.projectId)).limit(1);
  if (!project[0]) return { status: "not_found" as const, entity: "project" };

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
      slug: toSlug(input.name),
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
  if (
    input.targetServerId !== undefined ||
    input.composeFiles !== undefined ||
    input.composeProfiles !== undefined
  ) {
    const existingConfig =
      existing[0].config && typeof existing[0].config === "object"
        ? (existing[0].config as Record<string, unknown>)
        : {};
    updates.config = writeComposeSourceSelectionToConfig({
      config:
        input.targetServerId !== undefined
          ? { ...existingConfig, targetServerId: input.targetServerId }
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
