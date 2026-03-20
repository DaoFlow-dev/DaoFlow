import { stringify as stringifyYaml } from "yaml";

type JsonRecord = Record<string, unknown>;

export type ServiceRuntimeVolumeMode = "rw" | "ro";
export type ServiceRuntimeRestartPolicyName = "always" | "unless-stopped" | "on-failure" | "no";

export interface ServiceRuntimeVolume {
  source: string;
  target: string;
  mode: ServiceRuntimeVolumeMode;
}

export interface ServiceRuntimeRestartPolicy {
  name: ServiceRuntimeRestartPolicyName;
  maxRetries: number | null;
}

export interface ServiceRuntimeHealthCheck {
  command: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  startPeriodSeconds: number;
}

export interface ServiceRuntimeResources {
  cpuLimitCores: number | null;
  cpuReservationCores: number | null;
  memoryLimitMb: number | null;
  memoryReservationMb: number | null;
}

export interface ServiceRuntimeConfig {
  volumes: ServiceRuntimeVolume[];
  networks: string[];
  restartPolicy: ServiceRuntimeRestartPolicy | null;
  healthCheck: ServiceRuntimeHealthCheck | null;
  resources: ServiceRuntimeResources | null;
}

export interface ServiceRuntimeConfigPatch {
  volumes?: ServiceRuntimeVolume[] | null;
  networks?: string[] | null;
  restartPolicy?: ServiceRuntimeRestartPolicy | null;
  healthCheck?: ServiceRuntimeHealthCheck | null;
  resources?: ServiceRuntimeResources | null;
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

function readPositiveNumber(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) && value > 0 ? value : null;
}

function normalizeVolumes(value: unknown): ServiceRuntimeVolume[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return value
    .map((entry) => {
      const record = asRecord(entry);
      const source = readNonEmptyString(record.source);
      const target = readNonEmptyString(record.target);
      if (!source || !target) {
        return null;
      }

      return {
        source,
        target,
        mode: record.mode === "ro" ? "ro" : "rw"
      } satisfies ServiceRuntimeVolume;
    })
    .filter((entry): entry is ServiceRuntimeVolume => entry !== null);
}

function normalizeNetworks(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return [];
  }

  return [...new Set(value.map((entry) => readNonEmptyString(entry)).filter(Boolean) as string[])];
}

function normalizeRestartPolicy(value: unknown): ServiceRuntimeRestartPolicy | null {
  const record = asRecord(value);
  const name = record.name;
  if (name !== "always" && name !== "unless-stopped" && name !== "on-failure" && name !== "no") {
    return null;
  }

  return {
    name,
    maxRetries: name === "on-failure" ? readPositiveInteger(record.maxRetries) : null
  };
}

function normalizeHealthCheck(value: unknown): ServiceRuntimeHealthCheck | null {
  const record = asRecord(value);
  const command = readNonEmptyString(record.command);
  if (!command) {
    return null;
  }

  const intervalSeconds = readPositiveInteger(record.intervalSeconds) ?? 30;
  const timeoutSeconds = readPositiveInteger(record.timeoutSeconds) ?? 10;
  const retries = readPositiveInteger(record.retries) ?? 3;
  const startPeriodSeconds = readPositiveInteger(record.startPeriodSeconds) ?? 15;

  return {
    command,
    intervalSeconds,
    timeoutSeconds,
    retries,
    startPeriodSeconds
  };
}

function normalizeResources(value: unknown): ServiceRuntimeResources | null {
  const record = asRecord(value);
  const resources = {
    cpuLimitCores: readPositiveNumber(record.cpuLimitCores),
    cpuReservationCores: readPositiveNumber(record.cpuReservationCores),
    memoryLimitMb: readPositiveInteger(record.memoryLimitMb),
    memoryReservationMb: readPositiveInteger(record.memoryReservationMb)
  } satisfies ServiceRuntimeResources;

  return Object.values(resources).some((entry) => entry !== null) ? resources : null;
}

export function readServiceRuntimeConfig(value: unknown): ServiceRuntimeConfig | null {
  const record = asRecord(value);
  const runtimeConfig = {
    volumes: normalizeVolumes(record.volumes),
    networks: normalizeNetworks(record.networks),
    restartPolicy: normalizeRestartPolicy(record.restartPolicy),
    healthCheck: normalizeHealthCheck(record.healthCheck),
    resources: normalizeResources(record.resources)
  } satisfies ServiceRuntimeConfig;

  return hasServiceRuntimeConfig(runtimeConfig) ? runtimeConfig : null;
}

export function readServiceRuntimeConfigFromConfig(config: unknown): ServiceRuntimeConfig | null {
  return readServiceRuntimeConfig(asRecord(config).runtimeConfig);
}

export function hasServiceRuntimeConfig(
  runtimeConfig: ServiceRuntimeConfig | null | undefined
): runtimeConfig is ServiceRuntimeConfig {
  return Boolean(
    runtimeConfig &&
    (runtimeConfig.volumes.length > 0 ||
      runtimeConfig.networks.length > 0 ||
      runtimeConfig.restartPolicy ||
      runtimeConfig.healthCheck ||
      runtimeConfig.resources)
  );
}

export function writeServiceRuntimeConfigToConfig(input: {
  config: unknown;
  patch?: ServiceRuntimeConfigPatch | null;
}): JsonRecord {
  const next = { ...asRecord(input.config) };

  if (input.patch === undefined) {
    const normalized = readServiceRuntimeConfigFromConfig(next);
    if (normalized) {
      next.runtimeConfig = normalized;
    } else {
      delete next.runtimeConfig;
    }
    return next;
  }

  if (input.patch === null) {
    delete next.runtimeConfig;
    return next;
  }

  const existing = readServiceRuntimeConfigFromConfig(next);
  const merged = readServiceRuntimeConfig({
    volumes: input.patch.volumes === undefined ? existing?.volumes : (input.patch.volumes ?? []),
    networks:
      input.patch.networks === undefined ? existing?.networks : (input.patch.networks ?? []),
    restartPolicy:
      input.patch.restartPolicy === undefined
        ? existing?.restartPolicy
        : (input.patch.restartPolicy ?? null),
    healthCheck:
      input.patch.healthCheck === undefined
        ? existing?.healthCheck
        : (input.patch.healthCheck ?? null),
    resources:
      input.patch.resources === undefined ? existing?.resources : (input.patch.resources ?? null)
  });

  if (merged) {
    next.runtimeConfig = merged;
  } else {
    delete next.runtimeConfig;
  }

  return next;
}

function formatRestartPolicy(restartPolicy: ServiceRuntimeRestartPolicy): string {
  if (restartPolicy.name !== "on-failure") {
    return restartPolicy.name;
  }

  return restartPolicy.maxRetries ? `on-failure:${restartPolicy.maxRetries}` : "on-failure";
}

function formatMemoryMb(value: number | null): string | undefined {
  return value ? `${value}M` : undefined;
}

export function buildServiceRuntimeOverrideComposeDocument(input: {
  composeServiceName?: string | null;
  runtimeConfig?: ServiceRuntimeConfig | null;
}): Record<string, unknown> | null {
  if (!hasServiceRuntimeConfig(input.runtimeConfig)) {
    return null;
  }

  const serviceName = readNonEmptyString(input.composeServiceName);
  if (!serviceName) {
    return null;
  }

  const service: Record<string, unknown> = {};

  if (input.runtimeConfig.volumes.length > 0) {
    service.volumes = input.runtimeConfig.volumes.map(
      (volume) => `${volume.source}:${volume.target}${volume.mode === "ro" ? ":ro" : ""}`
    );
  }

  if (input.runtimeConfig.networks.length > 0) {
    service.networks = input.runtimeConfig.networks;
  }

  if (input.runtimeConfig.restartPolicy) {
    service.restart = formatRestartPolicy(input.runtimeConfig.restartPolicy);
  }

  if (input.runtimeConfig.healthCheck) {
    service.healthcheck = {
      test: ["CMD-SHELL", input.runtimeConfig.healthCheck.command],
      interval: `${input.runtimeConfig.healthCheck.intervalSeconds}s`,
      timeout: `${input.runtimeConfig.healthCheck.timeoutSeconds}s`,
      retries: input.runtimeConfig.healthCheck.retries,
      start_period: `${input.runtimeConfig.healthCheck.startPeriodSeconds}s`
    };
  }

  if (input.runtimeConfig.resources) {
    const limits: Record<string, unknown> = {};
    const reservations: Record<string, unknown> = {};

    if (input.runtimeConfig.resources.cpuLimitCores !== null) {
      service.cpus = String(input.runtimeConfig.resources.cpuLimitCores);
      limits.cpus = String(input.runtimeConfig.resources.cpuLimitCores);
    }
    if (input.runtimeConfig.resources.cpuReservationCores !== null) {
      reservations.cpus = String(input.runtimeConfig.resources.cpuReservationCores);
    }
    const memoryLimit = formatMemoryMb(input.runtimeConfig.resources.memoryLimitMb);
    if (memoryLimit) {
      service.mem_limit = memoryLimit;
      limits.memory = memoryLimit;
    }
    const memoryReservation = formatMemoryMb(input.runtimeConfig.resources.memoryReservationMb);
    if (memoryReservation) {
      service.mem_reservation = memoryReservation;
      reservations.memory = memoryReservation;
    }
    if (Object.keys(limits).length > 0 || Object.keys(reservations).length > 0) {
      service.deploy = {
        resources: {
          ...(Object.keys(limits).length > 0 ? { limits } : {}),
          ...(Object.keys(reservations).length > 0 ? { reservations } : {})
        }
      };
    }
  }

  return {
    services: {
      [serviceName]: service
    }
  };
}

export function renderServiceRuntimeOverrideComposePreview(input: {
  composeServiceName?: string | null;
  runtimeConfig?: ServiceRuntimeConfig | null;
}): string | null {
  const doc = buildServiceRuntimeOverrideComposeDocument(input);
  return doc ? stringifyYaml(doc) : null;
}
