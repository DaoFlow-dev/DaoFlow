import chalk from "chalk";
import { normalizeCliInput } from "../command-helpers";

export const DEFAULT_EXTERNAL_RESTORE_REASON =
  "Request an approved restore of a verified external PostgreSQL artifact.";
export const MAX_EXTERNAL_IMPORT_BYTES = 2 * 1024 * 1024 * 1024;

export function normalizeExternalObjectKey(value: string, field = "Object key"): string {
  const key = normalizeCliInput(value, field, { maxLength: 1024 });
  const parts = key.split("/");
  if (
    key.startsWith("/") ||
    key.includes("\\") ||
    parts.some((part) => !part || part === "." || part === "..")
  ) {
    throw new Error(`${field} must be a relative object key without traversal segments.`);
  }

  return key;
}

export function normalizeExternalObjectPrefix(value: string): string {
  const prefix = normalizeCliInput(value, "External import prefix", { maxLength: 1024 });
  const withoutTrailingSlash = prefix.endsWith("/") ? prefix.slice(0, -1) : prefix;
  if (!withoutTrailingSlash) {
    throw new Error("External import prefix must contain at least one path segment.");
  }

  normalizeExternalObjectKey(withoutTrailingSlash, "External import prefix");
  return `${withoutTrailingSlash}/`;
}

export function parsePositiveInteger(
  value: string,
  field: string,
  options?: { max?: number }
): number {
  const normalized = normalizeCliInput(value, field, {
    allowPathTraversal: true,
    maxLength: 20
  });
  if (!/^\d+$/.test(normalized)) {
    throw new Error(`${field} must be a positive integer.`);
  }

  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1 ||
    (options?.max !== undefined && parsed > options.max)
  ) {
    const suffix = options?.max === undefined ? "" : ` no greater than ${options.max}`;
    throw new Error(`${field} must be a positive integer${suffix}.`);
  }

  return parsed;
}

export function formatExternalBytes(value: number | string | null | undefined): string {
  const bytes = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return "unknown";
  if (bytes === 0) return "0 B";

  const units = ["B", "KB", "MB", "GB", "TB"];
  const unitIndex = Math.min(Math.floor(Math.log(bytes) / Math.log(1024)), units.length - 1);
  return `${(bytes / 1024 ** unitIndex).toFixed(unitIndex === 0 ? 0 : 1)} ${units[unitIndex]}`;
}

export function pinnedExternalIdentity(
  objectVersion: string | null | undefined,
  objectEtag: string | null | undefined
): string {
  return objectVersion ?? objectEtag ?? "unavailable";
}

export function renderExternalStatus(status: string): string {
  if (status === "verified" || status === "registered") return chalk.green(status);
  if (status === "failed") return chalk.red(status);
  if (status === "verifying" || status === "registering") return chalk.yellow(status);
  return chalk.dim(status);
}

export function validateSafetyFlags(dryRun: boolean | undefined, yes: boolean | undefined): void {
  if (dryRun && yes) {
    throw new Error("Use either --dry-run or --yes, not both.");
  }
}
