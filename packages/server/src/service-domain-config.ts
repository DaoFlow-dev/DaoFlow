type JsonRecord = Record<string, unknown>;

export type ServicePortProtocol = "tcp" | "udp";

export interface ServiceDomainEntry {
  id: string;
  hostname: string;
  isPrimary: boolean;
  createdAt: string;
}

export interface ServicePortMapping {
  id: string;
  hostPort: number;
  containerPort: number;
  protocol: ServicePortProtocol;
  createdAt: string;
}

export interface ServiceDomainConfig {
  domains: ServiceDomainEntry[];
  portMappings: ServicePortMapping[];
}

export interface ServiceDomainConfigPatch {
  domains?: ServiceDomainEntry[] | null;
  portMappings?: ServicePortMapping[] | null;
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readPositiveInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= 1 ? value : null;
}

function readIsoTimestamp(value: unknown): string | null {
  const raw = readNonEmptyString(value);
  if (!raw) {
    return null;
  }

  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

export function normalizeServiceDomainHostname(value: string): string | null {
  const trimmed = value.trim().toLowerCase().replace(/\.$/, "");
  if (!trimmed || trimmed.length > 253) {
    return null;
  }

  if (trimmed.startsWith("*.") || trimmed.includes("/") || trimmed.includes(":")) {
    return null;
  }

  const hostnamePattern = /^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/;
  return hostnamePattern.test(trimmed) ? trimmed : null;
}

function normalizeDomainEntries(value: unknown): ServiceDomainEntry[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenHostnames = new Set<string>();
  let primaryAssigned = false;

  return value
    .map((entry) => {
      const record = asRecord(entry);
      const id = readNonEmptyString(record.id);
      const hostnameRaw = readNonEmptyString(record.hostname);
      const hostname = hostnameRaw ? normalizeServiceDomainHostname(hostnameRaw) : null;
      const createdAt = readIsoTimestamp(record.createdAt);
      if (!id || !hostname || !createdAt || seenHostnames.has(hostname)) {
        return null;
      }

      seenHostnames.add(hostname);

      const wantsPrimary = record.isPrimary === true;
      const isPrimary = wantsPrimary && !primaryAssigned;
      primaryAssigned ||= isPrimary;

      return {
        id,
        hostname,
        isPrimary,
        createdAt
      } satisfies ServiceDomainEntry;
    })
    .filter((entry): entry is ServiceDomainEntry => entry !== null)
    .map((entry, index) =>
      primaryAssigned || index !== 0
        ? entry
        : {
            ...entry,
            isPrimary: true
          }
    );
}

function normalizePortMappings(value: unknown): ServicePortMapping[] {
  if (!Array.isArray(value)) {
    return [];
  }

  const seenKeys = new Set<string>();

  return value
    .map((entry) => {
      const record = asRecord(entry);
      const id = readNonEmptyString(record.id);
      const hostPort = readPositiveInteger(record.hostPort);
      const containerPort = readPositiveInteger(record.containerPort);
      const protocol = record.protocol === "udp" ? "udp" : "tcp";
      const createdAt = readIsoTimestamp(record.createdAt);
      const dedupeKey = `${hostPort}:${protocol}`;
      if (!id || !hostPort || !containerPort || !createdAt || seenKeys.has(dedupeKey)) {
        return null;
      }

      seenKeys.add(dedupeKey);

      return {
        id,
        hostPort,
        containerPort,
        protocol,
        createdAt
      } satisfies ServicePortMapping;
    })
    .filter((entry): entry is ServicePortMapping => entry !== null);
}

export function readServiceDomainConfig(value: unknown): ServiceDomainConfig | null {
  const record = asRecord(value);
  const config = {
    domains: normalizeDomainEntries(record.domains),
    portMappings: normalizePortMappings(record.portMappings)
  } satisfies ServiceDomainConfig;

  return config.domains.length > 0 || config.portMappings.length > 0 ? config : null;
}

export function readServiceDomainConfigFromConfig(config: unknown): ServiceDomainConfig | null {
  return readServiceDomainConfig(asRecord(config).domainConfig);
}

export function writeServiceDomainConfigToConfig(input: {
  config: unknown;
  patch?: ServiceDomainConfigPatch | null;
}): JsonRecord {
  const next = { ...asRecord(input.config) };

  if (input.patch === undefined) {
    const normalized = readServiceDomainConfigFromConfig(next);
    if (normalized) {
      next.domainConfig = normalized;
    } else {
      delete next.domainConfig;
    }
    return next;
  }

  if (input.patch === null) {
    delete next.domainConfig;
    return next;
  }

  const existing = readServiceDomainConfigFromConfig(next);
  const merged = readServiceDomainConfig({
    domains: input.patch.domains === undefined ? existing?.domains : (input.patch.domains ?? []),
    portMappings:
      input.patch.portMappings === undefined
        ? existing?.portMappings
        : (input.patch.portMappings ?? [])
  });

  if (merged) {
    next.domainConfig = merged;
  } else {
    delete next.domainConfig;
  }

  return next;
}
