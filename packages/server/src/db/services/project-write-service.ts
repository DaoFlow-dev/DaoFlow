import { eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { projects } from "../schema/projects";
import { asRecord, newId as id } from "./json-helpers";
import {
  mergeProjectSourceReadiness,
  readProjectSourceReadiness,
  validateProjectSourceReadiness
} from "./project-source-readiness";
import { findScopedProject } from "./project-scoped-queries";
import { toSlug } from "./project-service-helpers";
import type { CreateProjectInput, UpdateProjectInput } from "./project-service-types";
import {
  normalizeComposeFilePaths,
  normalizeComposeProfiles,
  writeComposeSourceSelectionToConfig
} from "../../compose-source";
import { mergeRepositoryPreparationConfig } from "../../repository-preparation";
import { writeWebhookAutoDeployConfigToConfig } from "../../webhook-auto-deploy";

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
