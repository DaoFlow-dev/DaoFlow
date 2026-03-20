import { basename, isAbsolute, posix } from "node:path";

export const DEFAULT_COMPOSE_FILE_PATH = "docker-compose.yml";

export interface ComposeSourceSelection {
  composeFiles: string[];
  composeProfiles: string[];
}

function readRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function readStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function readConfiguredComposeFiles(record: Record<string, unknown>): string[] | undefined {
  const composeFiles = readStringArray(record.composeFilePaths);
  if (composeFiles.length > 0) {
    return normalizeComposeFilePaths({ composeFiles });
  }

  if (typeof record.composeFilePath === "string") {
    return normalizeComposeFilePaths({ composePath: record.composeFilePath });
  }

  return undefined;
}

export function normalizeComposeFilePath(
  composePath: string | null | undefined,
  fallback = DEFAULT_COMPOSE_FILE_PATH
): string {
  const raw = composePath?.trim() ?? "";
  if (!raw) {
    return fallback;
  }

  const maybeAbsolute = raw.replace(/\\/g, "/");
  const relative = isAbsolute(maybeAbsolute) ? basename(maybeAbsolute) : maybeAbsolute;
  const normalized = posix.normalize(relative).replace(/^(\.\/)+/, "");

  return !normalized || normalized === "." ? fallback : normalized;
}

export function normalizeComposeFilePaths(input: {
  composeFiles?: Iterable<string | null | undefined> | null;
  composePath?: string | null;
  fallback?: string;
}): string[] {
  const fallback = input.fallback ?? DEFAULT_COMPOSE_FILE_PATH;
  const normalized: string[] = [];
  const seen = new Set<string>();

  for (const entry of input.composeFiles ?? []) {
    const composeFile = normalizeComposeFilePath(entry, fallback);
    if (seen.has(composeFile)) {
      continue;
    }
    seen.add(composeFile);
    normalized.push(composeFile);
  }

  if (normalized.length > 0) {
    return normalized;
  }

  return [normalizeComposeFilePath(input.composePath, fallback)];
}

export function normalizeComposeProfiles(
  value: Iterable<string | null | undefined> | null | undefined
): string[] {
  const profiles: string[] = [];
  const seen = new Set<string>();

  for (const entry of value ?? []) {
    const profile = entry?.trim();
    if (!profile || seen.has(profile)) {
      continue;
    }
    seen.add(profile);
    profiles.push(profile);
  }

  return profiles;
}

export function readComposeSourceSelection(input: {
  composePath?: string | null;
  projectConfig?: unknown;
  environmentConfig?: unknown;
  snapshot?: unknown;
}): ComposeSourceSelection {
  const projectConfig = readRecord(input.projectConfig);
  const environmentConfig = readRecord(input.environmentConfig);
  const snapshot = readRecord(input.snapshot);
  const snapshotComposeFiles = readConfiguredComposeFiles(snapshot);
  const environmentComposeFiles = readConfiguredComposeFiles(environmentConfig);
  const projectComposeFiles = readConfiguredComposeFiles(projectConfig);
  const snapshotComposeProfiles = readStringArray(snapshot.composeProfiles);
  const environmentComposeProfiles = readStringArray(environmentConfig.composeProfiles);
  const projectComposeProfiles = readStringArray(projectConfig.composeProfiles);

  const composeFiles = normalizeComposeFilePaths({
    composeFiles:
      snapshotComposeFiles && snapshotComposeFiles.length > 0
        ? snapshotComposeFiles
        : environmentComposeFiles && environmentComposeFiles.length > 0
          ? environmentComposeFiles
          : projectComposeFiles,
    composePath: input.composePath
  });
  const composeProfiles = normalizeComposeProfiles(
    snapshotComposeProfiles.length > 0
      ? snapshotComposeProfiles
      : environmentComposeProfiles.length > 0
        ? environmentComposeProfiles
        : projectComposeProfiles
  );

  return {
    composeFiles,
    composeProfiles
  };
}

export function writeComposeSourceSelectionToConfig(input: {
  config: Record<string, unknown>;
  composeFiles?: string[] | null;
  composeProfiles?: string[] | null;
}): Record<string, unknown> {
  const nextConfig = { ...input.config };
  const composeFiles = input.composeFiles
    ? normalizeComposeFilePaths({ composeFiles: input.composeFiles })
    : null;
  const composeProfiles =
    input.composeProfiles !== undefined
      ? normalizeComposeProfiles(input.composeProfiles)
      : undefined;

  if (composeFiles) {
    nextConfig.composeFilePaths = composeFiles;
    nextConfig.composeFilePath = composeFiles[0] ?? DEFAULT_COMPOSE_FILE_PATH;
  } else {
    delete nextConfig.composeFilePaths;
    delete nextConfig.composeFilePath;
  }

  if (composeProfiles !== undefined) {
    if (composeProfiles.length > 0) {
      nextConfig.composeProfiles = composeProfiles;
    } else {
      delete nextConfig.composeProfiles;
    }
  }

  return nextConfig;
}
