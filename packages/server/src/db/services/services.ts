import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { deployments } from "../schema/deployments";
import { services } from "../schema/services";
import { environments, projects } from "../schema/projects";
import type { AppRole } from "@daoflow/shared";
import { newId as id } from "./json-helpers";
import {
  readComposeReadinessProbeFromConfig,
  type ComposeReadinessProbeInput,
  writeComposeReadinessProbeToConfig
} from "../../compose-readiness";
import {
  readComposePreviewConfigFromConfig,
  type ComposePreviewConfigInput,
  writeComposePreviewConfigToConfig
} from "../../compose-preview";
import {
  readServiceRuntimeConfigFromConfig,
  renderServiceRuntimeOverrideComposePreview,
  writeServiceRuntimeConfigToConfig
} from "../../service-runtime-config";
import {
  readServiceDomainConfigFromConfig,
  writeServiceDomainConfigToConfig
} from "../../service-domain-config";
import {
  summarizeDeploymentHealth,
  summarizeRolloutStrategy,
  summarizeServiceRuntime
} from "./deployment-read-model";

/* ──────────────────────── Helpers ──────────────────────── */

function toSlug(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

/* ──────────────────────── Interfaces ──────────────────────── */

export interface CreateServiceInput {
  name: string;
  environmentId: string;
  projectId: string;
  sourceType: "compose" | "dockerfile" | "image";
  imageReference?: string;
  dockerfilePath?: string;
  composeServiceName?: string;
  port?: string;
  healthcheckPath?: string;
  readinessProbe?: ComposeReadinessProbeInput | null;
  preview?: ComposePreviewConfigInput | null;
  targetServerId?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface UpdateServiceInput {
  serviceId: string;
  name?: string;
  sourceType?: "compose" | "dockerfile" | "image";
  imageReference?: string;
  dockerfilePath?: string;
  composeServiceName?: string;
  port?: string;
  healthcheckPath?: string;
  readinessProbe?: ComposeReadinessProbeInput | null;
  preview?: ComposePreviewConfigInput | null;
  replicaCount?: string;
  targetServerId?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface DeleteServiceInput {
  serviceId: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

/* ──────────────────────── Service CRUD ──────────────────────── */

export function normalizeServiceRecord(service: typeof services.$inferSelect) {
  const config = writeServiceDomainConfigToConfig({
    config: writeServiceRuntimeConfigToConfig({
      config: writeComposePreviewConfigToConfig({
        config: writeComposeReadinessProbeToConfig({
          config: service.config
        })
      })
    })
  });

  return {
    ...service,
    config,
    domainConfig: readServiceDomainConfigFromConfig(config),
    runtimeConfig: readServiceRuntimeConfigFromConfig(config),
    runtimeConfigPreview: renderServiceRuntimeOverrideComposePreview({
      composeServiceName: service.composeServiceName,
      runtimeConfig: readServiceRuntimeConfigFromConfig(config)
    })
  };
}

function buildServiceDeploymentKey(input: {
  projectId: string;
  environmentId: string;
  name: string;
  sourceType: string;
}) {
  return `${input.projectId}:${input.environmentId}:${input.name}:${input.sourceType}`;
}

async function buildServiceReadIndex(serviceRows: (typeof services.$inferSelect)[]) {
  if (serviceRows.length === 0) {
    return {
      projectById: new Map<string, typeof projects.$inferSelect>(),
      environmentById: new Map<string, typeof environments.$inferSelect>(),
      latestDeploymentByKey: new Map<string, typeof deployments.$inferSelect>()
    };
  }

  const projectIds = [...new Set(serviceRows.map((row) => row.projectId))];
  const environmentIds = [...new Set(serviceRows.map((row) => row.environmentId))];

  const [projectRows, environmentRows, deploymentRows] = await Promise.all([
    db.select().from(projects).where(inArray(projects.id, projectIds)),
    db.select().from(environments).where(inArray(environments.id, environmentIds)),
    db
      .selectDistinctOn([
        deployments.projectId,
        deployments.environmentId,
        deployments.serviceName,
        deployments.sourceType
      ])
      .from(deployments)
      .where(inArray(deployments.environmentId, environmentIds))
      .orderBy(
        deployments.projectId,
        deployments.environmentId,
        deployments.serviceName,
        deployments.sourceType,
        desc(deployments.createdAt)
      )
  ]);

  const latestDeploymentByKey = new Map<string, typeof deployments.$inferSelect>();
  for (const deployment of deploymentRows) {
    const key = buildServiceDeploymentKey({
      projectId: deployment.projectId,
      environmentId: deployment.environmentId,
      name: deployment.serviceName,
      sourceType: deployment.sourceType
    });

    if (!latestDeploymentByKey.has(key)) {
      latestDeploymentByKey.set(key, deployment);
    }
  }

  return {
    projectById: new Map(projectRows.map((row) => [row.id, row])),
    environmentById: new Map(environmentRows.map((row) => [row.id, row])),
    latestDeploymentByKey
  };
}

function buildServiceReadModel(
  service: typeof services.$inferSelect,
  index: Awaited<ReturnType<typeof buildServiceReadIndex>>
) {
  const normalized = normalizeServiceRecord(service);
  const project = index.projectById.get(service.projectId);
  const environment = index.environmentById.get(service.environmentId);
  const latestDeployment =
    index.latestDeploymentByKey.get(
      buildServiceDeploymentKey({
        projectId: service.projectId,
        environmentId: service.environmentId,
        name: service.name,
        sourceType: service.sourceType
      })
    ) ?? null;
  const healthSummary = latestDeployment
    ? summarizeDeploymentHealth({ deployment: latestDeployment, steps: [] })
    : null;
  const targetServerName =
    latestDeployment && typeof latestDeployment.configSnapshot === "object"
      ? ((latestDeployment.configSnapshot as Record<string, unknown>).targetServerName as
          | string
          | undefined)
      : null;
  const runtimeSummary = summarizeServiceRuntime({
    latestDeployment,
    healthSummary,
    targetServerName
  });
  const rolloutStrategy = summarizeRolloutStrategy({
    sourceType: service.sourceType,
    serviceConfig: normalized.config,
    healthcheckPath: service.healthcheckPath
  });

  return {
    ...normalized,
    projectName: project?.name ?? null,
    environmentName: environment?.name ?? null,
    statusTone: runtimeSummary.statusTone,
    statusLabel: runtimeSummary.statusLabel,
    runtimeSummary,
    rolloutStrategy,
    latestDeployment: latestDeployment
      ? {
          id: latestDeployment.id,
          status: healthSummary?.status ?? "not-configured",
          statusLabel: healthSummary?.statusLabel ?? runtimeSummary.statusLabel,
          statusTone: healthSummary?.statusTone ?? runtimeSummary.statusTone,
          summary: healthSummary?.summary ?? runtimeSummary.summary,
          commitSha: latestDeployment.commitSha,
          imageTag: latestDeployment.imageTag,
          targetServerId: latestDeployment.targetServerId,
          targetServerName,
          createdAt: latestDeployment.createdAt.toISOString(),
          finishedAt: latestDeployment.concludedAt?.toISOString() ?? null
        }
      : null
  };
}

export async function createService(input: CreateServiceInput) {
  // Verify the environment exists
  const [env] = await db
    .select()
    .from(environments)
    .where(eq(environments.id, input.environmentId))
    .limit(1);

  if (!env) return { status: "not_found" as const, entity: "environment" };

  // Check for duplicate slug within environment
  const slug = toSlug(input.name);
  const [existing] = await db
    .select()
    .from(services)
    .where(and(eq(services.environmentId, input.environmentId), eq(services.slug, slug)))
    .limit(1);

  if (existing) return { status: "conflict" as const, conflictField: "name" };

  if (input.readinessProbe && input.sourceType !== "compose") {
    return {
      status: "invalid_config" as const,
      message: "Explicit readiness probes are only supported for compose services."
    };
  }
  if (input.preview?.enabled === true && input.sourceType !== "compose") {
    return {
      status: "invalid_config" as const,
      message: "Preview deployments are only supported for compose services."
    };
  }

  const serviceId = id();
  const [service] = await db
    .insert(services)
    .values({
      id: serviceId,
      name: input.name,
      slug,
      projectId: input.projectId,
      environmentId: input.environmentId,
      sourceType: input.sourceType,
      imageReference: input.imageReference ?? null,
      dockerfilePath: input.dockerfilePath ?? null,
      composeServiceName: input.composeServiceName ?? null,
      port: input.port ?? null,
      healthcheckPath: input.healthcheckPath ?? null,
      targetServerId: input.targetServerId ?? null,
      status: "inactive",
      config: writeComposePreviewConfigToConfig({
        config: writeComposeReadinessProbeToConfig({
          config: {},
          readinessProbe: input.readinessProbe
        }),
        preview: input.preview
      }),
      updatedAt: new Date()
    })
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `service/${serviceId}`,
    action: "service.create",
    inputSummary: `Created service "${input.name}" (${input.sourceType})`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: {
      resourceType: "service",
      resourceId: serviceId,
      resourceLabel: input.name,
      environmentId: input.environmentId
    }
  });

  return { status: "ok" as const, service: normalizeServiceRecord(service) };
}

export async function updateService(input: UpdateServiceInput) {
  const [existing] = await db
    .select()
    .from(services)
    .where(eq(services.id, input.serviceId))
    .limit(1);

  if (!existing) return { status: "not_found" as const };

  const nextSourceType = input.sourceType ?? existing.sourceType;
  if (input.readinessProbe && nextSourceType !== "compose") {
    return {
      status: "invalid_config" as const,
      message: "Explicit readiness probes are only supported for compose services."
    };
  }
  if (input.preview?.enabled === true && nextSourceType !== "compose") {
    return {
      status: "invalid_config" as const,
      message: "Preview deployments are only supported for compose services."
    };
  }

  const updates: Partial<typeof services.$inferInsert> = { updatedAt: new Date() };
  if (input.name !== undefined) {
    updates.name = input.name;
    updates.slug = toSlug(input.name);
  }
  if (input.sourceType !== undefined) updates.sourceType = input.sourceType;
  if (input.imageReference !== undefined) updates.imageReference = input.imageReference;
  if (input.dockerfilePath !== undefined) updates.dockerfilePath = input.dockerfilePath;
  if (input.composeServiceName !== undefined) updates.composeServiceName = input.composeServiceName;
  if (input.port !== undefined) updates.port = input.port;
  if (input.healthcheckPath !== undefined) updates.healthcheckPath = input.healthcheckPath;
  if (input.replicaCount !== undefined) updates.replicaCount = input.replicaCount;
  if (input.targetServerId !== undefined) updates.targetServerId = input.targetServerId;
  if (input.readinessProbe !== undefined) {
    updates.config = writeComposeReadinessProbeToConfig({
      config: existing.config,
      readinessProbe: input.readinessProbe
    });
  }
  if (input.preview !== undefined) {
    updates.config = writeComposePreviewConfigToConfig({
      config: updates.config ?? existing.config,
      preview: input.preview
    });
  } else if (nextSourceType !== "compose" && readComposeReadinessProbeFromConfig(existing.config)) {
    updates.config = writeComposeReadinessProbeToConfig({
      config: existing.config,
      readinessProbe: null
    });
  }
  if (
    nextSourceType !== "compose" &&
    readComposePreviewConfigFromConfig(updates.config ?? existing.config)
  ) {
    updates.config = writeComposePreviewConfigToConfig({
      config: updates.config ?? existing.config,
      preview: null
    });
  }

  const [service] = await db
    .update(services)
    .set(updates)
    .where(eq(services.id, input.serviceId))
    .returning();

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `service/${input.serviceId}`,
    action: "service.update",
    inputSummary: `Updated service "${service.name}"`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: { resourceType: "service", resourceId: input.serviceId }
  });

  return { status: "ok" as const, service: normalizeServiceRecord(service) };
}

export async function deleteService(input: DeleteServiceInput) {
  const [existing] = await db
    .select()
    .from(services)
    .where(eq(services.id, input.serviceId))
    .limit(1);

  if (!existing) return { status: "not_found" as const };

  await db.delete(services).where(eq(services.id, input.serviceId));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `service/${input.serviceId}`,
    action: "service.delete",
    inputSummary: `Deleted service "${existing.name}"`,
    permissionScope: "service:update",
    outcome: "success",
    metadata: { resourceType: "service", resourceId: input.serviceId }
  });

  return { status: "ok" as const };
}

export async function listServices(environmentId?: string, limit = 50) {
  if (environmentId) {
    const rows = await db
      .select()
      .from(services)
      .where(eq(services.environmentId, environmentId))
      .orderBy(desc(services.createdAt))
      .limit(limit);
    const index = await buildServiceReadIndex(rows);
    return rows.map((row) => buildServiceReadModel(row, index));
  }
  const rows = await db.select().from(services).orderBy(desc(services.createdAt)).limit(limit);
  const index = await buildServiceReadIndex(rows);
  return rows.map((row) => buildServiceReadModel(row, index));
}

export async function listServicesByProject(projectId: string) {
  const rows = await db
    .select()
    .from(services)
    .where(eq(services.projectId, projectId))
    .orderBy(desc(services.createdAt));
  const index = await buildServiceReadIndex(rows);
  return rows.map((row) => buildServiceReadModel(row, index));
}

export async function getService(serviceId: string) {
  const [service] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);

  if (!service) {
    return null;
  }

  const index = await buildServiceReadIndex([service]);
  return buildServiceReadModel(service, index);
}
