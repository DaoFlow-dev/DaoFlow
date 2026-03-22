import { and, desc, eq } from "drizzle-orm";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { services } from "../schema/services";
import { environments } from "../schema/projects";
import type { AppRole } from "@daoflow/shared";
import { newId as id } from "./json-helpers";
import {
  type ComposeReadinessProbeInput,
  readComposeReadinessProbeFromConfig
} from "../../compose-readiness";
import { type ComposePreviewConfigInput } from "../../compose-preview";
import {
  buildInitialServiceConfig,
  buildUpdatedServiceConfig,
  validateServiceConfigInput
} from "./service-config";
import {
  buildServiceReadIndex,
  buildServiceReadModel,
  normalizeServiceRecord
} from "./service-record-views";

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

  const validation = validateServiceConfigInput({
    sourceType: input.sourceType,
    healthcheckPath: input.healthcheckPath,
    readinessProbe: input.readinessProbe,
    preview: input.preview
  });

  if (validation) {
    return validation;
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
      config: buildInitialServiceConfig({
        readinessProbe: input.readinessProbe,
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

  const nextSourceType: CreateServiceInput["sourceType"] =
    input.sourceType ?? (existing.sourceType as CreateServiceInput["sourceType"]);
  const nextReadinessProbe =
    input.readinessProbe !== undefined
      ? input.readinessProbe
      : readComposeReadinessProbeFromConfig(existing.config);
  const validation = validateServiceConfigInput({
    sourceType: nextSourceType,
    healthcheckPath: input.healthcheckPath,
    readinessProbe: nextReadinessProbe,
    preview: input.preview
  });

  if (validation) {
    return validation;
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
  const nextConfig = buildUpdatedServiceConfig({
    existingConfig: existing.config,
    nextSourceType,
    readinessProbe: input.readinessProbe,
    preview: input.preview
  });

  if (nextConfig !== undefined) {
    updates.config = nextConfig;
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
