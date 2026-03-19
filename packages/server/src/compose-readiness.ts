type JsonRecord = Record<string, unknown>;

export interface ComposeReadinessProbeInput {
  type: "http";
  target: "published-port";
  port: number;
  path: string;
  host?: string;
  scheme?: "http" | "https";
  timeoutSeconds?: number;
  intervalSeconds?: number;
  successStatusCodes?: number[];
}

export interface ComposeReadinessProbe {
  type: "http";
  target: "published-port";
  port: number;
  path: string;
  host: string;
  scheme: "http" | "https";
  timeoutSeconds: number;
  intervalSeconds: number;
  successStatusCodes: number[];
}

export interface ComposeReadinessProbeSnapshot extends ComposeReadinessProbe {
  serviceName: string;
}

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
  if (record.type !== "http" || record.target !== "published-port") {
    return null;
  }

  const port = readInteger(record.port);
  const path = readNonEmptyString(record.path);
  if (!port || port < 1 || port > 65535 || !path) {
    return null;
  }

  const scheme = record.scheme === "https" ? "https" : DEFAULT_SCHEME;
  const host = readNonEmptyString(record.host) ?? DEFAULT_HOST;
  const timeoutSeconds = readInteger(record.timeoutSeconds) ?? DEFAULT_TIMEOUT_SECONDS;
  const intervalSeconds = readInteger(record.intervalSeconds) ?? DEFAULT_INTERVAL_SECONDS;
  if (timeoutSeconds < 1 || intervalSeconds < 1) {
    return null;
  }

  return {
    type: "http",
    target: "published-port",
    port,
    path,
    host,
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

export function buildComposeReadinessProbeUrl(probe: ComposeReadinessProbe): string {
  return `${probe.scheme}://${probe.host}:${probe.port}${probe.path}`;
}

function formatSuccessStatusCodes(codes: number[]): string {
  return codes.length === 1 ? String(codes[0]) : codes.join(", ");
}

export function describeComposeReadinessProbe(probe: ComposeReadinessProbe): string {
  return `HTTP readiness on ${buildComposeReadinessProbeUrl(probe)} expecting ${formatSuccessStatusCodes(probe.successStatusCodes)} within ${probe.timeoutSeconds}s (poll every ${probe.intervalSeconds}s)`;
}
