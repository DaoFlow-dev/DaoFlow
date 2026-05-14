import { asRecord } from "./db/services/json-helpers";

export interface DockerCleanupConfig {
  enabled: boolean;
  cronExpression: string;
  includeVolumes: boolean;
  retentionDays: number;
}

const DEFAULT_CRON = "0 3 * * 0"; // Sunday 3 AM
const DEFAULT_RETENTION_DAYS = 7;

function readNonEmptyString(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : null;
}

export function readDockerCleanupConfig(metadata: unknown): DockerCleanupConfig | null {
  const cleanup = asRecord(asRecord(metadata).dockerCleanup);
  if (cleanup.enabled !== true) {
    return null;
  }

  return {
    enabled: true,
    cronExpression: readNonEmptyString(cleanup.cronExpression) ?? DEFAULT_CRON,
    includeVolumes: cleanup.includeVolumes === true,
    retentionDays:
      typeof cleanup.retentionDays === "number" && cleanup.retentionDays > 0
        ? cleanup.retentionDays
        : DEFAULT_RETENTION_DAYS
  };
}

export function writeDockerCleanupConfigToMetadata(input: {
  metadata: unknown;
  patch: {
    enabled: boolean;
    cronExpression?: string | null;
    includeVolumes?: boolean;
    retentionDays?: number;
  };
}) {
  const next = { ...asRecord(input.metadata) };
  if (!input.patch.enabled) {
    delete next.dockerCleanup;
    return next;
  }

  next.dockerCleanup = {
    enabled: true,
    cronExpression: input.patch.cronExpression?.trim() || DEFAULT_CRON,
    includeVolumes: input.patch.includeVolumes ?? false,
    retentionDays: input.patch.retentionDays ?? DEFAULT_RETENTION_DAYS
  };
  return next;
}
