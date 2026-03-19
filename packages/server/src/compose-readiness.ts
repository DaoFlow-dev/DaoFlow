type JsonRecord = Record<string, unknown>;

type ComposeReadinessTransport = "http" | "tcp";
type ComposeReadinessTarget = "published-port" | "internal-network";

interface ComposeReadinessProbeInputBase {
  target: ComposeReadinessTarget;
  port: number;
  timeoutSeconds?: number;
  intervalSeconds?: number;
}

export interface ComposeHttpPublishedPortReadinessProbeInput extends ComposeReadinessProbeInputBase {
  type: "http";
  target: "published-port";
  path: string;
  host?: string;
  scheme?: "http" | "https";
  successStatusCodes?: number[];
}

export interface ComposeHttpInternalNetworkReadinessProbeInput extends ComposeReadinessProbeInputBase {
  type: "http";
  target: "internal-network";
  path: string;
  scheme?: "http" | "https";
  successStatusCodes?: number[];
}

export interface ComposeTcpPublishedPortReadinessProbeInput extends ComposeReadinessProbeInputBase {
  type: "tcp";
  target: "published-port";
  host?: string;
}

export interface ComposeTcpInternalNetworkReadinessProbeInput extends ComposeReadinessProbeInputBase {
  type: "tcp";
  target: "internal-network";
}

export type ComposeReadinessProbeInput =
  | ComposeHttpPublishedPortReadinessProbeInput
  | ComposeHttpInternalNetworkReadinessProbeInput
  | ComposeTcpPublishedPortReadinessProbeInput
  | ComposeTcpInternalNetworkReadinessProbeInput;

interface ComposeReadinessProbeBase {
  type: ComposeReadinessTransport;
  target: ComposeReadinessTarget;
  port: number;
  timeoutSeconds: number;
  intervalSeconds: number;
}

export interface ComposeHttpPublishedPortReadinessProbe extends ComposeReadinessProbeBase {
  type: "http";
  target: "published-port";
  path: string;
  host: string;
  scheme: "http" | "https";
  successStatusCodes: number[];
}

export interface ComposeHttpInternalNetworkReadinessProbe extends ComposeReadinessProbeBase {
  type: "http";
  target: "internal-network";
  path: string;
  scheme: "http" | "https";
  successStatusCodes: number[];
}

export interface ComposeTcpPublishedPortReadinessProbe extends ComposeReadinessProbeBase {
  type: "tcp";
  target: "published-port";
  host: string;
}

export interface ComposeTcpInternalNetworkReadinessProbe extends ComposeReadinessProbeBase {
  type: "tcp";
  target: "internal-network";
}

export type ComposeReadinessProbe =
  | ComposeHttpPublishedPortReadinessProbe
  | ComposeHttpInternalNetworkReadinessProbe
  | ComposeTcpPublishedPortReadinessProbe
  | ComposeTcpInternalNetworkReadinessProbe;

export type ComposeReadinessProbeSnapshot = ComposeReadinessProbe & {
  serviceName: string;
};

const DEFAULT_HOST = "127.0.0.1";
const DEFAULT_SCHEME = "http";
const DEFAULT_TIMEOUT_SECONDS = 60;
const DEFAULT_INTERVAL_SECONDS = 3;
const DEFAULT_SUCCESS_STATUS_CODES = [200];

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

function readInteger(value: unknown): number | null {
  return typeof value === "number" && Number.isInteger(value) ? value : null;
}

function normalizeStatusCodes(value: unknown): number[] {
  if (!Array.isArray(value)) {
    return [...DEFAULT_SUCCESS_STATUS_CODES];
  }

  const uniqueCodes = [
    ...new Set(value.filter((code): code is number => readInteger(code) !== null))
  ]
    .filter((code) => code >= 100 && code <= 599)
    .sort((a, b) => a - b);

  return uniqueCodes.length > 0 ? uniqueCodes : [...DEFAULT_SUCCESS_STATUS_CODES];
}

export function readComposeReadinessProbe(value: unknown): ComposeReadinessProbe | null {
  const record = asRecord(value);
  const type = record.type;
  const target = record.target;
  if (
    (type !== "http" && type !== "tcp") ||
    (target !== "published-port" && target !== "internal-network")
  ) {
    return null;
  }

  const port = readInteger(record.port);
  if (!port || port < 1 || port > 65535) {
    return null;
  }

  const timeoutSeconds = readInteger(record.timeoutSeconds) ?? DEFAULT_TIMEOUT_SECONDS;
  const intervalSeconds = readInteger(record.intervalSeconds) ?? DEFAULT_INTERVAL_SECONDS;
  if (timeoutSeconds < 1 || intervalSeconds < 1) {
    return null;
  }

  if (type === "tcp") {
    if (target === "internal-network") {
      return {
        type: "tcp",
        target: "internal-network",
        port,
        timeoutSeconds,
        intervalSeconds
      };
    }

    return {
      type: "tcp",
      target: "published-port",
      host: readNonEmptyString(record.host) ?? DEFAULT_HOST,
      port,
      timeoutSeconds,
      intervalSeconds
    };
  }

  const path = readNonEmptyString(record.path);
  if (!path) {
    return null;
  }

  const scheme = record.scheme === "https" ? "https" : DEFAULT_SCHEME;
  if (target === "internal-network") {
    return {
      type: "http",
      target: "internal-network",
      port,
      path,
      scheme,
      timeoutSeconds,
      intervalSeconds,
      successStatusCodes: normalizeStatusCodes(record.successStatusCodes)
    };
  }

  return {
    type: "http",
    target: "published-port",
    port,
    path,
    host: readNonEmptyString(record.host) ?? DEFAULT_HOST,
    scheme,
    timeoutSeconds,
    intervalSeconds,
    successStatusCodes: normalizeStatusCodes(record.successStatusCodes)
  };
}

export function readComposeReadinessProbeFromConfig(config: unknown): ComposeReadinessProbe | null {
  return readComposeReadinessProbe(asRecord(config).readinessProbe);
}

export function readComposeReadinessProbeSnapshot(
  value: unknown
): ComposeReadinessProbeSnapshot | null {
  const record = asRecord(value);
  const probe = readComposeReadinessProbe(record);
  const serviceName = readNonEmptyString(record.serviceName);
  if (!probe || !serviceName) {
    return null;
  }

  return {
    ...probe,
    serviceName
  };
}

export function writeComposeReadinessProbeToConfig(input: {
  config: unknown;
  readinessProbe?: ComposeReadinessProbeInput | null;
}): JsonRecord {
  const next = { ...asRecord(input.config) };

  if (input.readinessProbe === undefined) {
    const normalized = readComposeReadinessProbe(next.readinessProbe);
    if (normalized) {
      next.readinessProbe = normalized;
    } else {
      delete next.readinessProbe;
    }
    return next;
  }

  if (input.readinessProbe === null) {
    delete next.readinessProbe;
    return next;
  }

  const normalized = readComposeReadinessProbe(input.readinessProbe);
  if (normalized) {
    next.readinessProbe = normalized;
  } else {
    delete next.readinessProbe;
  }

  return next;
}

export function snapshotComposeReadinessProbe(input: {
  probe: ComposeReadinessProbe;
  serviceName: string;
}): ComposeReadinessProbeSnapshot {
  return {
    ...input.probe,
    serviceName: input.serviceName.trim()
  };
}

function readComposeReadinessProbeHost(probe: ComposeReadinessProbe, serviceName?: string): string {
  if (probe.target === "published-port") {
    return probe.host;
  }

  return readNonEmptyString(serviceName) ?? "service";
}

export function buildComposeReadinessProbeUrl(
  probe: ComposeReadinessProbe,
  serviceName?: string
): string {
  const host = readComposeReadinessProbeHost(probe, serviceName);
  if (probe.type === "tcp") {
    return `tcp://${host}:${probe.port}`;
  }

  return `${probe.scheme}://${host}:${probe.port}${probe.path}`;
}

function formatSuccessStatusCodes(codes: number[]): string {
  return codes.length === 1 ? String(codes[0]) : codes.join(", ");
}

function describeComposeReadinessTarget(probe: ComposeReadinessProbe): string {
  return probe.target === "published-port" ? "published endpoint" : "compose internal network";
}

export function describeComposeReadinessProbe(
  probe: ComposeReadinessProbe,
  serviceName?: string
): string {
  const target = describeComposeReadinessTarget(probe);
  const location = buildComposeReadinessProbeUrl(probe, serviceName);

  if (probe.type === "tcp") {
    return `TCP readiness on ${target} ${location} within ${probe.timeoutSeconds}s (poll every ${probe.intervalSeconds}s)`;
  }

  return `HTTP readiness on ${target} ${location} expecting ${formatSuccessStatusCodes(probe.successStatusCodes)} within ${probe.timeoutSeconds}s (poll every ${probe.intervalSeconds}s)`;
}
