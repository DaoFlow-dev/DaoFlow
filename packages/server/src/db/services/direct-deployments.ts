import { and, eq } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { createEnvironment, createProject, updateEnvironment } from "./projects";
import { createService, updateService } from "./services";
import { resolveTeamIdForUser } from "./teams";

interface ActorContext {
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface EnsureDirectDeploymentScopeInput extends ActorContext {
  serverId: string;
  projectRef?: string;
  projectName?: string;
  environmentName?: string;
  serviceName?: string;
}

function sanitizeName(value: string, fallback: string): string {
  const trimmed = value.trim();
  if (!trimmed) return fallback;

  const cleaned = trimmed
    .replace(/[^a-zA-Z0-9._ -]+/g, "-")
    .replace(/\s+/g, "-")
    .replace(/-+/g, "-")
    .replace(/(^-|-$)/g, "");

  return cleaned.slice(0, 80) || fallback;
}

async function resolveServerId(serverRef: string): Promise<string> {
  const ref = serverRef.trim();
  if (!ref) throw new Error("Server reference is required.");

  const [byId] = await db
    .select({ id: servers.id })
    .from(servers)
    .where(eq(servers.id, ref))
    .limit(1);
  if (byId) return byId.id;

  const [byName] = await db
    .select({ id: servers.id })
    .from(servers)
    .where(eq(servers.name, ref))
    .limit(1);
  if (byName) return byName.id;

  throw new Error(`Server "${ref}" not found.`);
}

function toSlug(value: string): string {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 40);
}

async function resolveProject(
  projectRef: string | undefined,
  fallbackProjectName: string,
  actor: ActorContext
) {
  const reference = projectRef?.trim();

  if (reference) {
    const [byId] = await db.select().from(projects).where(eq(projects.id, reference)).limit(1);
    if (byId) {
      return byId;
    }

    const [byName] = await db.select().from(projects).where(eq(projects.name, reference)).limit(1);
    if (byName) {
      return byName;
    }
  }

  const [existing] = await db
    .select()
    .from(projects)
    .where(eq(projects.name, fallbackProjectName))
    .limit(1);
  if (existing) {
    return existing;
  }

  const teamId = await resolveTeamIdForUser(actor.requestedByUserId);
  if (!teamId) {
    throw new Error("No organization is available for this user.");
  }

  const created = await createProject({
    name: fallbackProjectName,
    description: "Direct Compose deployment project",
    teamId,
    requestedByUserId: actor.requestedByUserId,
    requestedByEmail: actor.requestedByEmail,
    requestedByRole: actor.requestedByRole
  });

  if (created.status !== "ok") {
    throw new Error(`Failed to create project ${fallbackProjectName}.`);
  }

  return created.project;
}

async function resolveEnvironment(
  projectId: string,
  environmentName: string,
  serverId: string,
  actor: ActorContext
) {
  const slug = toSlug(environmentName);
  const [existing] = await db
    .select()
    .from(environments)
    .where(and(eq(environments.projectId, projectId), eq(environments.slug, slug)))
    .limit(1);

  if (!existing) {
    const created = await createEnvironment({
      projectId,
      name: environmentName,
      targetServerId: serverId,
      requestedByUserId: actor.requestedByUserId,
      requestedByEmail: actor.requestedByEmail,
      requestedByRole: actor.requestedByRole
    });

    if (created.status !== "ok") {
      throw new Error(`Failed to create environment ${environmentName}.`);
    }

    return created.environment;
  }

  const config =
    existing.config && typeof existing.config === "object" && !Array.isArray(existing.config)
      ? (existing.config as Record<string, unknown>)
      : {};

  if (config.targetServerId !== serverId) {
    const updated = await updateEnvironment({
      environmentId: existing.id,
      targetServerId: serverId,
      requestedByUserId: actor.requestedByUserId,
      requestedByEmail: actor.requestedByEmail,
      requestedByRole: actor.requestedByRole
    });

    if (updated.status !== "ok") {
      throw new Error(`Failed to retarget environment ${environmentName}.`);
    }

    return updated.environment;
  }

  return existing;
}

async function resolveStackService(
  projectId: string,
  environmentId: string,
  serverId: string,
  serviceName: string,
  actor: ActorContext
) {
  const slug = toSlug(serviceName);
  const [existing] = await db
    .select()
    .from(services)
    .where(and(eq(services.environmentId, environmentId), eq(services.slug, slug)))
    .limit(1);

  if (!existing) {
    const created = await createService({
      name: serviceName,
      projectId,
      environmentId,
      sourceType: "compose",
      targetServerId: serverId,
      requestedByUserId: actor.requestedByUserId,
      requestedByEmail: actor.requestedByEmail,
      requestedByRole: actor.requestedByRole
    });

    if (created.status !== "ok") {
      throw new Error(`Failed to create service ${serviceName}.`);
    }

    return created.service;
  }

  const updated = await updateService({
    serviceId: existing.id,
    sourceType: "compose",
    targetServerId: serverId,
    requestedByUserId: actor.requestedByUserId,
    requestedByEmail: actor.requestedByEmail,
    requestedByRole: actor.requestedByRole
  });

  if (updated.status !== "ok") {
    throw new Error(`Failed to update service ${serviceName}.`);
  }

  return updated.service;
}

export async function ensureDirectDeploymentScope(input: EnsureDirectDeploymentScopeInput) {
  const resolvedServerId = await resolveServerId(input.serverId);

  const projectName = sanitizeName(
    input.projectName ?? input.projectRef ?? "uploaded-compose",
    "uploaded-compose"
  );
  const environmentName = sanitizeName(input.environmentName ?? "production", "production");
  const serviceName = sanitizeName(input.serviceName ?? projectName, projectName);

  const actor: ActorContext = {
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole
  };

  const project = await resolveProject(input.projectRef, projectName, actor);
  const environment = await resolveEnvironment(
    project.id,
    environmentName,
    resolvedServerId,
    actor
  );
  const service = await resolveStackService(
    project.id,
    environment.id,
    resolvedServerId,
    serviceName,
    actor
  );

  return {
    project,
    environment,
    service
  };
}
