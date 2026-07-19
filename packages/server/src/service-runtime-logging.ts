export const SERVICE_RUNTIME_LOGGING_MIN_SIZE_MB = 1;
export const SERVICE_RUNTIME_LOGGING_MAX_SIZE_MB = 1_024;
export const SERVICE_RUNTIME_LOGGING_MIN_FILES = 1;
export const SERVICE_RUNTIME_LOGGING_MAX_FILES = 20;
/**
 * A per-container ceiling keeps the independent file-size and file-count
 * limits from combining into unreasonably large host-disk allocations.
 */
export const SERVICE_RUNTIME_LOGGING_MAX_RETENTION_MB = 4_096;

export const SERVICE_RUNTIME_LOGGING_MARKER = "x-daoflow-managed-logging";
const SERVICE_RUNTIME_LOGGING_MARKER_VERSION = 1;

export interface ServiceRuntimeLogging {
  managed: true;
  driver: "json-file";
  maxSizeMb: number;
  maxFiles: number;
  allowSourceOverride: boolean;
}

type JsonRecord = Record<string, unknown>;

interface DaoFlowManagedLoggingMarker {
  version: 1;
  driver: "json-file";
  maxSizeMb: number;
  maxFiles: number;
  sourceLogging: unknown;
}

export class ComposeLoggingSourceConflictError extends Error {
  constructor(serviceName: string) {
    super(
      `Compose service "${serviceName}" already declares logging. ` +
        "Set logging.allowSourceOverride to true to let DaoFlow temporarily manage it."
    );
    this.name = "ComposeLoggingSourceConflictError";
  }
}

export class ComposeLoggingMarkerConflictError extends Error {
  constructor(serviceName: string) {
    super(
      `Compose service "${serviceName}" uses the reserved ` +
        `${SERVICE_RUNTIME_LOGGING_MARKER} extension. Remove it from the source Compose file.`
    );
    this.name = "ComposeLoggingMarkerConflictError";
  }
}

function asRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value) ? (value as JsonRecord) : {};
}

function isRecord(value: unknown): value is JsonRecord {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function readPositiveIntegerInRange(value: unknown, min: number, max: number): number | null {
  return typeof value === "number" && Number.isInteger(value) && value >= min && value <= max
    ? value
    : null;
}

function readConfiguredInteger(input: {
  record: JsonRecord;
  key: string;
  min: number;
  max: number;
  defaultValue: number;
}): number | null {
  if (input.record[input.key] === undefined) {
    return input.defaultValue;
  }

  return readPositiveIntegerInRange(input.record[input.key], input.min, input.max);
}

function cloneComposeValue<T>(value: T): T {
  return structuredClone(value);
}

function hasOwn(record: JsonRecord, key: string): boolean {
  return Object.prototype.hasOwnProperty.call(record, key);
}

export function isServiceRuntimeLoggingWithinBounds(input: {
  maxSizeMb: number;
  maxFiles: number;
}): boolean {
  return (
    Number.isInteger(input.maxSizeMb) &&
    input.maxSizeMb >= SERVICE_RUNTIME_LOGGING_MIN_SIZE_MB &&
    input.maxSizeMb <= SERVICE_RUNTIME_LOGGING_MAX_SIZE_MB &&
    Number.isInteger(input.maxFiles) &&
    input.maxFiles >= SERVICE_RUNTIME_LOGGING_MIN_FILES &&
    input.maxFiles <= SERVICE_RUNTIME_LOGGING_MAX_FILES &&
    input.maxSizeMb * input.maxFiles <= SERVICE_RUNTIME_LOGGING_MAX_RETENTION_MB
  );
}

export function normalizeServiceRuntimeLogging(value: unknown): ServiceRuntimeLogging | null {
  if (!isRecord(value)) {
    return null;
  }

  const record = asRecord(value);
  if (record.managed === false || (record.managed !== undefined && record.managed !== true)) {
    return null;
  }
  if (record.driver !== undefined && record.driver !== "json-file") {
    return null;
  }

  const maxSizeMb = readConfiguredInteger({
    record,
    key: "maxSizeMb",
    min: SERVICE_RUNTIME_LOGGING_MIN_SIZE_MB,
    max: SERVICE_RUNTIME_LOGGING_MAX_SIZE_MB,
    defaultValue: 10
  });
  const maxFiles = readConfiguredInteger({
    record,
    key: "maxFiles",
    min: SERVICE_RUNTIME_LOGGING_MIN_FILES,
    max: SERVICE_RUNTIME_LOGGING_MAX_FILES,
    defaultValue: 3
  });

  if (!maxSizeMb || !maxFiles || !isServiceRuntimeLoggingWithinBounds({ maxSizeMb, maxFiles })) {
    return null;
  }

  return {
    managed: true,
    driver: "json-file",
    maxSizeMb,
    maxFiles,
    allowSourceOverride: record.allowSourceOverride === true
  };
}

export function buildManagedServiceLoggingCompose(logging: ServiceRuntimeLogging): JsonRecord {
  return {
    driver: "json-file",
    options: {
      "max-size": `${logging.maxSizeMb}m`,
      "max-file": String(logging.maxFiles)
    }
  };
}

function buildManagedLoggingMarker(input: {
  logging: ServiceRuntimeLogging;
  sourceLogging: unknown;
}): DaoFlowManagedLoggingMarker {
  return {
    version: SERVICE_RUNTIME_LOGGING_MARKER_VERSION,
    driver: "json-file",
    maxSizeMb: input.logging.maxSizeMb,
    maxFiles: input.logging.maxFiles,
    sourceLogging: input.sourceLogging === null ? null : cloneComposeValue(input.sourceLogging)
  };
}

function readManagedLoggingMarker(value: unknown): DaoFlowManagedLoggingMarker | null {
  const marker = asRecord(value);
  const maxSizeMb = readPositiveIntegerInRange(
    marker.maxSizeMb,
    SERVICE_RUNTIME_LOGGING_MIN_SIZE_MB,
    SERVICE_RUNTIME_LOGGING_MAX_SIZE_MB
  );
  const maxFiles = readPositiveIntegerInRange(
    marker.maxFiles,
    SERVICE_RUNTIME_LOGGING_MIN_FILES,
    SERVICE_RUNTIME_LOGGING_MAX_FILES
  );
  const sourceLogging = marker.sourceLogging;

  if (
    marker.version !== SERVICE_RUNTIME_LOGGING_MARKER_VERSION ||
    marker.driver !== "json-file" ||
    !maxSizeMb ||
    !maxFiles ||
    !isServiceRuntimeLoggingWithinBounds({ maxSizeMb, maxFiles }) ||
    !hasOwn(marker, "sourceLogging")
  ) {
    return null;
  }

  return {
    version: SERVICE_RUNTIME_LOGGING_MARKER_VERSION,
    driver: "json-file",
    maxSizeMb,
    maxFiles,
    sourceLogging: sourceLogging === null ? null : cloneComposeValue(sourceLogging)
  };
}

function matchesManagedLogging(value: unknown, marker: DaoFlowManagedLoggingMarker): boolean {
  const logging = asRecord(value);
  const options = asRecord(logging.options);

  return (
    logging.driver === "json-file" &&
    Object.keys(logging).length === 2 &&
    Object.keys(options).length === 2 &&
    options["max-size"] === `${marker.maxSizeMb}m` &&
    options["max-file"] === String(marker.maxFiles)
  );
}

function readOwnedLogging(service: JsonRecord): DaoFlowManagedLoggingMarker | null {
  const marker = readManagedLoggingMarker(service[SERVICE_RUNTIME_LOGGING_MARKER]);
  return marker && matchesManagedLogging(service.logging, marker) ? marker : null;
}

function resolveComposeService(doc: JsonRecord, serviceName: string): JsonRecord {
  const services = asRecord(doc.services);
  const service = services[serviceName];
  if (!isRecord(service)) {
    throw new Error(
      `Managed logging targets unknown service "${serviceName}" in the rendered compose file.`
    );
  }
  return service;
}

/**
 * Applies only the managed logging field. Other runtime override fields remain
 * preview-only until their own materialization contract is introduced.
 */
export function applyManagedServiceLoggingToComposeDocument(input: {
  doc: JsonRecord;
  serviceName: string;
  logging: ServiceRuntimeLogging | null;
  trustManagedMarker?: boolean;
}): void {
  const service = resolveComposeService(input.doc, input.serviceName);
  if (!input.trustManagedMarker && hasOwn(service, SERVICE_RUNTIME_LOGGING_MARKER)) {
    throw new ComposeLoggingMarkerConflictError(input.serviceName);
  }

  const ownedMarker = input.trustManagedMarker ? readOwnedLogging(service) : null;
  const sourceLogging = service.logging;

  if (!input.logging) {
    if (ownedMarker) {
      if (ownedMarker.sourceLogging !== null) {
        service.logging = cloneComposeValue(ownedMarker.sourceLogging);
      } else {
        delete service.logging;
      }
      delete service[SERVICE_RUNTIME_LOGGING_MARKER];
    }
    return;
  }

  if (sourceLogging !== undefined && !ownedMarker && !input.logging.allowSourceOverride) {
    throw new ComposeLoggingSourceConflictError(input.serviceName);
  }

  const preservedSourceLogging = ownedMarker
    ? ownedMarker.sourceLogging
    : sourceLogging === undefined
      ? null
      : cloneComposeValue(sourceLogging);

  service.logging = buildManagedServiceLoggingCompose(input.logging);
  service[SERVICE_RUNTIME_LOGGING_MARKER] = buildManagedLoggingMarker({
    logging: input.logging,
    sourceLogging: preservedSourceLogging
  });
}
