import { normalizeInventoryStatus } from "@daoflow/shared";
import { asRecord } from "./json-helpers";
import { environments, projects } from "../schema/projects";

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readConfigString(config: unknown, key: string): string | null {
  const value = asRecord(config)[key];
  return typeof value === "string" && value.length > 0 ? value : null;
}

function readConfigStringArray(config: unknown, key: string): string[] {
  return readStringArray(asRecord(config)[key]);
}

export function mapEnvironmentSummary(
  environment: typeof environments.$inferSelect,
  serviceCount: number
) {
  return {
    ...environment,
    targetServerId: readConfigString(environment.config, "targetServerId"),
    composeFiles: readConfigStringArray(environment.config, "composeFilePaths"),
    composeProfiles: readConfigStringArray(environment.config, "composeProfiles"),
    serviceCount,
    statusTone: normalizeInventoryStatus(environment.status)
  };
}

export function mapProjectSummary(
  project: typeof projects.$inferSelect,
  counts: {
    environmentCount: number;
    serviceCount: number;
  },
  sourceReadiness: unknown
) {
  return {
    ...project,
    description: readConfigString(project.config, "description"),
    composeFiles: readConfigStringArray(project.config, "composeFilePaths"),
    composeProfiles: readConfigStringArray(project.config, "composeProfiles"),
    environmentCount: counts.environmentCount,
    serviceCount: counts.serviceCount,
    statusTone: normalizeInventoryStatus(project.status),
    sourceReadiness
  };
}
