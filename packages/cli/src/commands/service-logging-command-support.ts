import chalk from "chalk";
import { normalizeOptionalCliInput } from "../command-helpers";
import type { ServiceLoggingStateOutput, ServiceRuntimeLoggingOutput } from "../trpc-contract";

export const DEFAULT_MAX_SIZE_MB = 10;
export const DEFAULT_MAX_FILES = 3;
export const MAX_SIZE_MB = 1024;
export const MAX_FILES = 20;
export const MAX_RETENTION_MB = 4096;

export const SHOW_HELP = `
Required scope:
  diagnostics:read

Example:
  daoflow services logging show --service svc_123 --json

Example JSON shape:
  { "ok": true, "data": { "service": { "id": "svc_123", "name": "api" }, "configured": null, "inspection": { "status": "not-deployed", "inspectedAt": "...", "containers": [] } } }
`;

export const SET_HELP = `
Required scopes:
  --dry-run: deploy:read
  execute:   service:update

Examples:
  daoflow services logging set --service svc_123 --dry-run --json
  daoflow services logging set --service svc_123 --max-size-mb 10 --max-files 3 --yes --json

Example JSON shape:
  { "ok": true, "data": { "service": { "id": "svc_123", "name": "api" }, "logging": { "managed": true, "driver": "json-file", "maxSizeMb": 10, "maxFiles": 3, "allowSourceOverride": false }, "runtimeConfigPreview": "services: ..." } }
`;

export const CLEAR_HELP = `
Required scopes:
  --dry-run: deploy:read
  execute:   service:update

Examples:
  daoflow services logging clear --service svc_123 --dry-run --json
  daoflow services logging clear --service svc_123 --yes --json

Example JSON shape:
  { "ok": true, "data": { "service": { "id": "svc_123", "name": "api" }, "logging": null, "runtimeConfigPreview": null } }
`;

export function parseBoundedInteger(
  value: string | undefined,
  label: string,
  defaultValue: number,
  maximum: number
): number {
  const normalized = normalizeOptionalCliInput(value, label);
  if (!normalized) return defaultValue;

  const parsed = Number(normalized);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > maximum) {
    throw new Error(`${label} must be a whole number between 1 and ${maximum}.`);
  }
  return parsed;
}

export function readLoggingConfig(value: unknown): ServiceRuntimeLoggingOutput | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const logging = (value as Record<string, unknown>).logging;
  if (!logging || typeof logging !== "object" || Array.isArray(logging)) return null;
  const record = logging as Record<string, unknown>;
  if (
    record.managed !== true ||
    record.driver !== "json-file" ||
    typeof record.maxSizeMb !== "number" ||
    typeof record.maxFiles !== "number"
  ) {
    return null;
  }

  return {
    managed: true,
    driver: "json-file",
    maxSizeMb: record.maxSizeMb,
    maxFiles: record.maxFiles,
    allowSourceOverride: record.allowSourceOverride === true
  };
}

export function printInspection(inspection: ServiceLoggingStateOutput): void {
  console.log(`  Active state: ${inspection.status}`);
  console.log(`  Inspected:    ${inspection.inspectedAt}`);
  if (inspection.reason) {
    console.log(`  Reason:       ${inspection.reason}`);
  }
  if (inspection.containers.length === 0) {
    console.log(chalk.dim("  No deployed containers were available for inspection."));
    return;
  }

  for (const container of inspection.containers) {
    const driver = container.driver ?? "not set";
    const maxSize = container.maxSize ?? "not set";
    const maxFiles = container.maxFiles ?? "not set";
    const match =
      container.matchesDesired === null
        ? chalk.dim("not compared")
        : container.matchesDesired
          ? chalk.green("matches")
          : chalk.yellow("differs");
    console.log(
      `  ${container.name}: ${driver} max-size=${maxSize} max-file=${maxFiles} (${match})`
    );
  }
}
