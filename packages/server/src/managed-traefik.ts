import type { servers } from "./db/schema/servers";
import type { services } from "./db/schema/services";
import { asRecord } from "./db/services/json-helpers";
import type { ServiceDomainEntry, ServicePortMapping } from "./service-domain-config";

export interface ManagedTraefikProxyConfig {
  enabled: true;
  networkName: string;
  entrypoint: string;
  certificateResolver: string;
  dnsTarget: string | null;
}

export interface ManagedTraefikMiddleware {
  type:
    | "redirect-https"
    | "basic-auth"
    | "strip-prefix"
    | "headers"
    | "rate-limit"
    | "ip-whitelist";
  name: string;
  config: Record<string, unknown>;
}

export interface ManagedTraefikRouteIntent {
  domainId: string;
  hostname: string;
  targetServiceName: string;
  targetPort: number;
  routerName: string;
  traefikServiceName: string;
  networkName: string;
  entrypoint: string;
  certificateResolver: string;
  middlewares: ManagedTraefikMiddleware[];
}

export interface ManagedTraefikRoutingPlan {
  provider: "traefik";
  proxy: ManagedTraefikProxyConfig;
  routes: ManagedTraefikRouteIntent[];
  unresolvedDomains: Array<{ domainId: string; hostname: string; reason: string }>;
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPort(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 && value <= 65535
    ? value
    : null;
}

function safeSlug(value: string): string {
  const normalized = value
    .toLowerCase()
    .replace(/[^a-z0-9-]+/g, "-")
    .replace(/^-+|-+$/g, "");
  return normalized.slice(0, 48) || "route";
}

function firstTcpContainerPort(portMappings: ServicePortMapping[]): number | null {
  return portMappings.find((mapping) => mapping.protocol === "tcp")?.containerPort ?? null;
}

function readServicePort(service: Pick<typeof services.$inferSelect, "port">): number | null {
  const parsed = Number.parseInt(service.port ?? "", 10);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : null;
}

export function readManagedTraefikProxyConfig(metadata: unknown): ManagedTraefikProxyConfig | null {
  const proxy = asRecord(asRecord(metadata).managedTraefikProxy);
  if (proxy.enabled !== true) {
    return null;
  }

  return {
    enabled: true,
    networkName: readNonEmptyString(proxy.networkName) ?? "daoflow-proxy",
    entrypoint: readNonEmptyString(proxy.entrypoint) ?? "websecure",
    certificateResolver: readNonEmptyString(proxy.certificateResolver) ?? "letsencrypt",
    dnsTarget: readNonEmptyString(proxy.dnsTarget)
  };
}

export function writeManagedTraefikProxyConfigToMetadata(input: {
  metadata: unknown;
  patch: {
    enabled: boolean;
    networkName?: string | null;
    entrypoint?: string | null;
    certificateResolver?: string | null;
    dnsTarget?: string | null;
  };
}) {
  const next = { ...asRecord(input.metadata) };
  if (!input.patch.enabled) {
    delete next.managedTraefikProxy;
    return next;
  }

  next.managedTraefikProxy = {
    enabled: true,
    networkName: input.patch.networkName?.trim() || "daoflow-proxy",
    entrypoint: input.patch.entrypoint?.trim() || "websecure",
    certificateResolver: input.patch.certificateResolver?.trim() || "letsencrypt",
    dnsTarget: input.patch.dnsTarget?.trim() || null
  };
  return next;
}

export function buildManagedTraefikRoutingPlan(input: {
  service: Pick<typeof services.$inferSelect, "name" | "composeServiceName" | "port">;
  server: typeof servers.$inferSelect | null;
  domains: ServiceDomainEntry[];
  portMappings: ServicePortMapping[];
}): ManagedTraefikRoutingPlan | null {
  const managedDomains = input.domains.filter((domain) => domain.routingMode === "managed-traefik");
  if (managedDomains.length === 0) {
    return null;
  }

  const proxy = input.server ? readManagedTraefikProxyConfig(input.server.metadata) : null;
  if (!proxy) {
    return {
      provider: "traefik",
      proxy: {
        enabled: true,
        networkName: "daoflow-proxy",
        entrypoint: "websecure",
        certificateResolver: "letsencrypt",
        dnsTarget: null
      },
      routes: [],
      unresolvedDomains: managedDomains.map((domain) => ({
        domainId: domain.id,
        hostname: domain.hostname,
        reason: "No managed Traefik proxy is configured for the target server."
      }))
    };
  }

  const targetServiceName = input.service.composeServiceName ?? input.service.name;
  const fallbackPort = firstTcpContainerPort(input.portMappings) ?? readServicePort(input.service);
  const routes: ManagedTraefikRouteIntent[] = [];
  const unresolvedDomains: ManagedTraefikRoutingPlan["unresolvedDomains"] = [];

  for (const domain of managedDomains) {
    const targetPort = readPort(domain.targetPort) ?? fallbackPort;
    if (!targetPort) {
      unresolvedDomains.push({
        domainId: domain.id,
        hostname: domain.hostname,
        reason: "No target container port is configured for this managed route."
      });
      continue;
    }

    const slug = `${safeSlug(targetServiceName)}-${safeSlug(domain.hostname)}`;
    routes.push({
      domainId: domain.id,
      hostname: domain.hostname,
      targetServiceName,
      targetPort,
      routerName: `daoflow-${slug}`.slice(0, 63),
      traefikServiceName: `daoflow-${slug}-svc`.slice(0, 63),
      networkName: proxy.networkName,
      entrypoint: proxy.entrypoint,
      certificateResolver: proxy.certificateResolver,
      middlewares: []
    });
  }

  return {
    provider: "traefik",
    proxy,
    routes,
    unresolvedDomains
  };
}

export function readManagedTraefikRoutingPlan(value: unknown): ManagedTraefikRoutingPlan | null {
  const record = asRecord(value);
  if (record.provider !== "traefik") {
    return null;
  }

  const proxyRecord = asRecord(record.proxy);
  const proxy: ManagedTraefikProxyConfig = {
    enabled: true,
    networkName: readNonEmptyString(proxyRecord.networkName) ?? "daoflow-proxy",
    entrypoint: readNonEmptyString(proxyRecord.entrypoint) ?? "websecure",
    certificateResolver: readNonEmptyString(proxyRecord.certificateResolver) ?? "letsencrypt",
    dnsTarget: readNonEmptyString(proxyRecord.dnsTarget)
  };

  const routes = Array.isArray(record.routes)
    ? record.routes
        .map((route) => {
          const routeRecord = asRecord(route);
          const domainId = readNonEmptyString(routeRecord.domainId);
          const hostname = readNonEmptyString(routeRecord.hostname);
          const targetServiceName = readNonEmptyString(routeRecord.targetServiceName);
          const targetPort = readPort(routeRecord.targetPort);
          if (!domainId || !hostname || !targetServiceName || !targetPort) {
            return null;
          }

          return {
            domainId,
            hostname,
            targetServiceName,
            targetPort,
            routerName: readNonEmptyString(routeRecord.routerName) ?? safeSlug(hostname),
            traefikServiceName:
              readNonEmptyString(routeRecord.traefikServiceName) ?? safeSlug(hostname),
            networkName: readNonEmptyString(routeRecord.networkName) ?? proxy.networkName,
            entrypoint: readNonEmptyString(routeRecord.entrypoint) ?? proxy.entrypoint,
            certificateResolver:
              readNonEmptyString(routeRecord.certificateResolver) ?? proxy.certificateResolver,
            middlewares: Array.isArray(routeRecord.middlewares)
              ? (routeRecord.middlewares as ManagedTraefikMiddleware[])
              : []
          } satisfies ManagedTraefikRouteIntent;
        })
        .filter((route): route is ManagedTraefikRouteIntent => route !== null)
    : [];

  return {
    provider: "traefik",
    proxy,
    routes,
    unresolvedDomains: []
  };
}
