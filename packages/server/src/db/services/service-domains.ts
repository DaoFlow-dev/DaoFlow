import { and, eq, inArray } from "drizzle-orm";
import type { AppRole } from "@daoflow/shared";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { projects } from "../schema/projects";
import { services } from "../schema/services";
import { tunnelRoutes, tunnels } from "../schema/tunnels";
import { newId as id } from "./json-helpers";
import {
  normalizeServiceDomainHostname,
  readServiceDomainConfigFromConfig,
  type ServiceDomainEntry,
  type ServicePortMapping,
  type ServicePortProtocol,
  writeServiceDomainConfigToConfig
} from "../../service-domain-config";

export type ServiceDomainProxyStatus = "matched" | "missing" | "inactive" | "conflict";
export type ServiceDomainTlsStatus = "ready" | "pending" | "inactive" | "conflict";

export interface ServiceDomainObservedRoute {
  hostname: string;
  service: string;
  path: string | null;
  status: string;
  tunnelId: string;
  tunnelName: string;
}

export interface ServiceDomainStateRecord extends ServiceDomainEntry {
  proxyStatus: ServiceDomainProxyStatus;
  tlsStatus: ServiceDomainTlsStatus;
  observedRoute: ServiceDomainObservedRoute | null;
}

export interface ServicePortMappingInput {
  id?: string;
  hostPort: number;
  containerPort: number;
  protocol: ServicePortProtocol;
}

interface ServiceContext {
  service: typeof services.$inferSelect;
  teamId: string;
}

export interface ServiceDomainState {
  serviceId: string;
  serviceName: string;
  domains: ServiceDomainStateRecord[];
  portMappings: ServicePortMapping[];
  summary: {
    primaryDomain: string | null;
    desiredDomainCount: number;
    matchedDomainCount: number;
    missingDomainCount: number;
    inactiveDomainCount: number;
    conflictDomainCount: number;
  };
}

export interface DomainMutationInputBase {
  serviceId: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

function invalidPort(value: number) {
  return !Number.isInteger(value) || value < 1 || value > 65535;
}

function normalizeDomainEntries(domains: ServiceDomainEntry[]): ServiceDomainEntry[] {
  const normalized = domains.map((domain, index) => ({
    ...domain,
    isPrimary: domain.isPrimary && domains.findIndex((entry) => entry.isPrimary) === index
  }));

  if (normalized.length > 0 && !normalized.some((domain) => domain.isPrimary)) {
    normalized[0] = {
      ...normalized[0],
      isPrimary: true
    };
  }

  return normalized;
}

async function loadServiceContext(serviceId: string): Promise<ServiceContext | null> {
  const [row] = await db
    .select({
      service: services,
      teamId: projects.teamId
    })
    .from(services)
    .innerJoin(projects, eq(projects.id, services.projectId))
    .where(eq(services.id, serviceId))
    .limit(1);

  return row ?? null;
}

function classifyDomainState(input: {
  hostname: string;
  serviceName: string;
  observedRoute: ServiceDomainObservedRoute | null;
}): Pick<ServiceDomainStateRecord, "proxyStatus" | "tlsStatus"> {
  if (!input.observedRoute) {
    return {
      proxyStatus: "missing",
      tlsStatus: "pending"
    };
  }

  if (input.observedRoute.service !== input.serviceName) {
    return {
      proxyStatus: "conflict",
      tlsStatus: "conflict"
    };
  }

  if (input.observedRoute.status !== "active") {
    return {
      proxyStatus: "inactive",
      tlsStatus: "inactive"
    };
  }

  return {
    proxyStatus: "matched",
    tlsStatus: "ready"
  };
}

export async function getServiceDomainState(input: {
  serviceId: string;
}): Promise<ServiceDomainState | null> {
  const context = await loadServiceContext(input.serviceId);
  if (!context) {
    return null;
  }

  const config = readServiceDomainConfigFromConfig(context.service.config);
  const desiredDomains = config?.domains ?? [];
  const desiredHostnames = desiredDomains.map((domain) => domain.hostname);

  const routeRows =
    desiredHostnames.length === 0
      ? []
      : await db
          .select({
            hostname: tunnelRoutes.hostname,
            service: tunnelRoutes.service,
            path: tunnelRoutes.path,
            status: tunnelRoutes.status,
            tunnelId: tunnelRoutes.tunnelId,
            tunnelName: tunnels.name
          })
          .from(tunnelRoutes)
          .innerJoin(tunnels, eq(tunnels.id, tunnelRoutes.tunnelId))
          .where(
            and(
              eq(tunnels.teamId, context.teamId),
              inArray(tunnelRoutes.hostname, desiredHostnames)
            )
          );

  const routeByHostname = new Map(routeRows.map((route) => [route.hostname, route]));
  const domains = desiredDomains.map((domain) => {
    const observedRoute = routeByHostname.get(domain.hostname) ?? null;
    const status = classifyDomainState({
      hostname: domain.hostname,
      serviceName: context.service.name,
      observedRoute
    });

    return {
      ...domain,
      ...status,
      observedRoute
    } satisfies ServiceDomainStateRecord;
  });

  return {
    serviceId: context.service.id,
    serviceName: context.service.name,
    domains,
    portMappings: config?.portMappings ?? [],
    summary: {
      primaryDomain: domains.find((domain) => domain.isPrimary)?.hostname ?? null,
      desiredDomainCount: domains.length,
      matchedDomainCount: domains.filter((domain) => domain.proxyStatus === "matched").length,
      missingDomainCount: domains.filter((domain) => domain.proxyStatus === "missing").length,
      inactiveDomainCount: domains.filter((domain) => domain.proxyStatus === "inactive").length,
      conflictDomainCount: domains.filter((domain) => domain.proxyStatus === "conflict").length
    }
  };
}

async function writeServiceConfig(input: {
  context: ServiceContext;
  config: unknown;
  action: string;
  inputSummary: string;
  metadata: Record<string, unknown>;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}) {
  await db
    .update(services)
    .set({
      config: input.config,
      updatedAt: new Date()
    })
    .where(eq(services.id, input.context.service.id));

  await db.insert(auditEntries).values({
    actorType: "user",
    actorId: input.requestedByUserId,
    actorEmail: input.requestedByEmail,
    actorRole: input.requestedByRole,
    targetResource: `service/${input.context.service.id}`,
    action: input.action,
    inputSummary: input.inputSummary,
    permissionScope: "service:update",
    outcome: "success",
    metadata: {
      resourceType: "service",
      resourceId: input.context.service.id,
      ...input.metadata
    }
  });

  const state = await getServiceDomainState({
    serviceId: input.context.service.id
  });
  if (!state) {
    throw new Error("Service domain state disappeared after update.");
  }

  return state;
}

export async function addServiceDomain(
  input: DomainMutationInputBase & {
    hostname: string;
  }
) {
  const context = await loadServiceContext(input.serviceId);
  if (!context) {
    return { status: "not_found" as const };
  }

  const hostname = normalizeServiceDomainHostname(input.hostname);
  if (!hostname) {
    return {
      status: "invalid" as const,
      message: "Enter a valid hostname like app.example.com."
    };
  }

  const existing = readServiceDomainConfigFromConfig(context.service.config);
  const currentDomains = existing?.domains ?? [];
  if (currentDomains.some((domain) => domain.hostname === hostname)) {
    return {
      status: "conflict" as const,
      message: `Domain ${hostname} is already configured for this service.`
    };
  }

  const domains = normalizeDomainEntries([
    ...currentDomains,
    {
      id: id(),
      hostname,
      isPrimary: currentDomains.length === 0,
      createdAt: new Date().toISOString()
    }
  ]);

  const config = writeServiceDomainConfigToConfig({
    config: context.service.config,
    patch: {
      domains
    }
  });

  const state = await writeServiceConfig({
    context,
    config,
    action: "service.domain.add",
    inputSummary: `Added domain "${hostname}" to "${context.service.name}"`,
    metadata: {
      hostname
    },
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole
  });

  return { status: "ok" as const, state };
}

export async function removeServiceDomain(
  input: DomainMutationInputBase & {
    domainId: string;
  }
) {
  const context = await loadServiceContext(input.serviceId);
  if (!context) {
    return { status: "not_found" as const };
  }

  const existing = readServiceDomainConfigFromConfig(context.service.config);
  const currentDomains = existing?.domains ?? [];
  const removed = currentDomains.find((domain) => domain.id === input.domainId);
  if (!removed) {
    return {
      status: "domain_not_found" as const
    };
  }

  const domains = normalizeDomainEntries(
    currentDomains.filter((domain) => domain.id !== input.domainId)
  );
  const config = writeServiceDomainConfigToConfig({
    config: context.service.config,
    patch: {
      domains
    }
  });

  const state = await writeServiceConfig({
    context,
    config,
    action: "service.domain.remove",
    inputSummary: `Removed domain "${removed.hostname}" from "${context.service.name}"`,
    metadata: {
      hostname: removed.hostname,
      domainId: removed.id
    },
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole
  });

  return { status: "ok" as const, state };
}

export async function setPrimaryServiceDomain(
  input: DomainMutationInputBase & {
    domainId: string;
  }
) {
  const context = await loadServiceContext(input.serviceId);
  if (!context) {
    return { status: "not_found" as const };
  }

  const existing = readServiceDomainConfigFromConfig(context.service.config);
  const currentDomains = existing?.domains ?? [];
  const primary = currentDomains.find((domain) => domain.id === input.domainId);
  if (!primary) {
    return {
      status: "domain_not_found" as const
    };
  }

  const domains = currentDomains.map((domain) => ({
    ...domain,
    isPrimary: domain.id === input.domainId
  }));
  const config = writeServiceDomainConfigToConfig({
    config: context.service.config,
    patch: {
      domains
    }
  });

  const state = await writeServiceConfig({
    context,
    config,
    action: "service.domain.primary.update",
    inputSummary: `Marked "${primary.hostname}" as the primary domain for "${context.service.name}"`,
    metadata: {
      hostname: primary.hostname,
      domainId: primary.id
    },
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole
  });

  return { status: "ok" as const, state };
}

export async function updateServicePortMappings(
  input: DomainMutationInputBase & {
    portMappings: ServicePortMappingInput[];
  }
) {
  const context = await loadServiceContext(input.serviceId);
  if (!context) {
    return { status: "not_found" as const };
  }

  const seenKeys = new Set<string>();
  const existing = readServiceDomainConfigFromConfig(context.service.config);
  const existingPortMappings = new Map(
    (existing?.portMappings ?? []).map((mapping) => [mapping.id, mapping])
  );

  const portMappings: ServicePortMapping[] = [];
  for (const mapping of input.portMappings) {
    if (invalidPort(mapping.hostPort) || invalidPort(mapping.containerPort)) {
      return {
        status: "invalid" as const,
        message: "Port mappings must use integer ports between 1 and 65535."
      };
    }

    const protocol = mapping.protocol === "udp" ? "udp" : "tcp";
    const dedupeKey = `${mapping.hostPort}:${protocol}`;
    if (seenKeys.has(dedupeKey)) {
      return {
        status: "conflict" as const,
        message: `Duplicate host port ${mapping.hostPort}/${protocol} is not allowed.`
      };
    }
    seenKeys.add(dedupeKey);

    const existingMapping =
      typeof mapping.id === "string" ? existingPortMappings.get(mapping.id) : undefined;
    portMappings.push({
      id: existingMapping?.id ?? id(),
      hostPort: mapping.hostPort,
      containerPort: mapping.containerPort,
      protocol,
      createdAt: existingMapping?.createdAt ?? new Date().toISOString()
    });
  }

  const config = writeServiceDomainConfigToConfig({
    config: context.service.config,
    patch: {
      portMappings
    }
  });

  const state = await writeServiceConfig({
    context,
    config,
    action: "service.port-mappings.update",
    inputSummary: `Updated ${portMappings.length} port mappings for "${context.service.name}"`,
    metadata: {
      portMappings: portMappings.map((mapping) => ({
        hostPort: mapping.hostPort,
        containerPort: mapping.containerPort,
        protocol: mapping.protocol
      }))
    },
    requestedByUserId: input.requestedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole
  });

  return { status: "ok" as const, state };
}
