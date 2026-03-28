import { StatusTone, type StatusTone as StatusToneValue } from "@daoflow/shared";
import type { ServiceDomainConfig } from "../../service-domain-config";

export type ServiceEndpointState = "healthy" | "pending" | "failed" | "unavailable";

export interface ServiceEndpointRouteObservation {
  hostname: string;
  service: string;
  path: string | null;
  status: string;
  tunnelName: string;
}

export interface ServiceEndpointLink {
  id: string;
  kind: "domain" | "port";
  label: string;
  href: string | null;
  copyValue: string;
  status: ServiceEndpointState;
  statusLabel: string;
  statusTone: StatusToneValue;
  summary: string;
  isCanonical: boolean;
  isPublic: boolean;
}

export interface ServiceEndpointSummary {
  status: ServiceEndpointState;
  statusLabel: string;
  statusTone: StatusToneValue;
  summary: string;
  primaryLabel: string | null;
  primaryHref: string | null;
  links: ServiceEndpointLink[];
}

function toStatusLabel(status: ServiceEndpointState) {
  if (status === "healthy") {
    return "Healthy";
  }
  if (status === "pending") {
    return "Pending";
  }
  if (status === "failed") {
    return "Failed";
  }

  return "Unavailable";
}

function toStatusTone(status: ServiceEndpointState): StatusToneValue {
  if (status === "healthy") {
    return StatusTone.Healthy;
  }
  if (status === "pending") {
    return StatusTone.Running;
  }
  if (status === "failed") {
    return StatusTone.Failed;
  }

  return StatusTone.Queued;
}

function readPublishedPortState(runtimeTone: string | null | undefined): ServiceEndpointState {
  if (runtimeTone === StatusTone.Healthy) {
    return "healthy";
  }
  if (runtimeTone === StatusTone.Failed) {
    return "unavailable";
  }

  return "pending";
}

function describeRouteState(input: {
  serviceName: string;
  hostname: string;
  route: ServiceEndpointRouteObservation | null;
  runtimeTone: string | null | undefined;
}) {
  if (!input.route) {
    return {
      status:
        input.runtimeTone === StatusTone.Failed ? ("unavailable" as const) : ("pending" as const),
      summary:
        input.runtimeTone === StatusTone.Failed
          ? `No active route is attached to ${input.hostname} and the latest rollout is not healthy.`
          : `DaoFlow expects ${input.hostname} to come online, but no active route is attached yet.`
    };
  }

  if (input.route.service !== input.serviceName) {
    return {
      status: "failed" as const,
      summary: `${input.hostname} currently points at ${input.route.service}, not ${input.serviceName}.`
    };
  }

  if (input.route.status !== "active") {
    return {
      status: "unavailable" as const,
      summary: `${input.hostname} is configured through ${input.route.tunnelName}, but the observed route is ${input.route.status}.`
    };
  }

  return {
    status: "healthy" as const,
    summary: `${input.hostname} is live through ${input.route.tunnelName}.`
  };
}

export function buildServiceEndpointSummary(input: {
  serviceName: string;
  domainConfig: ServiceDomainConfig | null;
  observedRoutesByHostname?: ReadonlyMap<string, ServiceEndpointRouteObservation>;
  runtimeTone?: string | null;
  servicePort?: string | null;
  healthcheckPath?: string | null;
  targetServerHost?: string | null;
  targetServerName?: string | null;
}): ServiceEndpointSummary {
  const links: ServiceEndpointLink[] = [];
  const observedRoutesByHostname =
    input.observedRoutesByHostname ?? new Map<string, ServiceEndpointRouteObservation>();
  const domainConfig = input.domainConfig;

  if (domainConfig) {
    for (const domain of domainConfig.domains) {
      const route = observedRoutesByHostname.get(domain.hostname) ?? null;
      const routeState = describeRouteState({
        serviceName: input.serviceName,
        hostname: domain.hostname,
        route,
        runtimeTone: input.runtimeTone
      });

      links.push({
        id: `domain-${domain.id}`,
        kind: "domain",
        label: domain.isPrimary ? "Primary domain" : "Additional domain",
        href: `https://${domain.hostname}`,
        copyValue: `https://${domain.hostname}`,
        status: routeState.status,
        statusLabel: toStatusLabel(routeState.status),
        statusTone: toStatusTone(routeState.status),
        summary: routeState.summary,
        isCanonical: domain.isPrimary,
        isPublic: true
      });
    }

    for (const mapping of domainConfig.portMappings) {
      const publishedState = readPublishedPortState(input.runtimeTone);
      const targetLabel = input.targetServerName?.trim()
        ? `${input.targetServerName}${input.targetServerHost ? ` (${input.targetServerHost})` : ""}`
        : (input.targetServerHost ?? "the target server");
      const publishedValue = input.targetServerHost
        ? `${input.targetServerHost}:${mapping.hostPort}/${mapping.protocol}`
        : `${mapping.hostPort}/${mapping.protocol}`;

      links.push({
        id: `port-${mapping.id}`,
        kind: "port",
        label: `Published ${mapping.protocol.toUpperCase()} ${mapping.hostPort}`,
        href: null,
        copyValue: publishedValue,
        status: publishedState,
        statusLabel: toStatusLabel(publishedState),
        statusTone: toStatusTone(publishedState),
        summary: `Published ${mapping.protocol.toUpperCase()} ${mapping.hostPort} forwards to container port ${mapping.containerPort} on ${targetLabel}.`,
        isCanonical:
          domainConfig.domains.length === 0 && mapping.protocol === "tcp" && links.length === 0,
        isPublic: true
      });
    }
  }

  const canonicalLink =
    links.find((link) => link.isCanonical) ??
    links.find((link) => link.kind === "domain") ??
    links[0] ??
    null;

  if (!canonicalLink) {
    const servicePortDetail =
      input.servicePort && input.servicePort.trim().length > 0
        ? ` ${input.serviceName} still exposes container port ${input.servicePort.trim()}${
            input.healthcheckPath ? ` with health path ${input.healthcheckPath}.` : "."
          }`
        : "";

    return {
      status: "unavailable",
      statusLabel: toStatusLabel("unavailable"),
      statusTone: toStatusTone("unavailable"),
      summary: `No public endpoint is configured for ${input.serviceName}.${servicePortDetail}`,
      primaryLabel: null,
      primaryHref: null,
      links: []
    };
  }

  return {
    status: canonicalLink.status,
    statusLabel: canonicalLink.statusLabel,
    statusTone: canonicalLink.statusTone,
    summary: canonicalLink.summary,
    primaryLabel: canonicalLink.label,
    primaryHref: canonicalLink.href,
    links
  };
}
