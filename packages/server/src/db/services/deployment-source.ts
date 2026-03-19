import { asRecord, readString } from "./json-helpers";
import type { ComposeImageOverride, ConfigSnapshot } from "../../worker/step-management";
import { basename, isAbsolute } from "node:path";
import {
  hasRepositoryPreparation,
  readRepositoryPreparationConfig
} from "../../repository-preparation";

type ProjectRow = {
  repoFullName: string | null;
  repoUrl: string | null;
  gitProviderId: string | null;
  gitInstallationId: string | null;
  defaultBranch: string | null;
  composePath: string | null;
  config: unknown;
};

type EnvironmentRow = {
  config: unknown;
};

type ComposeSourceSnapshotInput = {
  project: ProjectRow;
  environment?: EnvironmentRow | null;
  composeServiceName?: string | null;
};

const EXECUTION_ONLY_SNAPSHOT_KEYS = new Set([
  "projectName",
  "environmentName",
  "targetServerName",
  "targetServerHost",
  "queueName",
  "workerHint",
  "temporalWorkflowId",
  "temporalRunId"
]);

function normalizeRepositoryPath(path: string, fallback: string): string {
  if (!path) return fallback;
  return isAbsolute(path) ? basename(path) : path;
}

function resolveProjectBranch(project: ProjectRow): string {
  return project.defaultBranch ?? readString(asRecord(project.config), "defaultBranch", "main");
}

function readNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0 ? value.trim() : undefined;
}

export function resolveComposeFilePath(input: ComposeSourceSnapshotInput): string {
  const environmentConfig = asRecord(input.environment?.config);

  return normalizeRepositoryPath(
    input.project.composePath ??
      readString(environmentConfig, "composeFilePath", "docker-compose.yml"),
    "docker-compose.yml"
  );
}

export function buildRepositorySourceSnapshot(project: ProjectRow): ConfigSnapshot {
  const hasRepositorySource =
    Boolean(project.repoUrl) ||
    Boolean(project.repoFullName) ||
    Boolean(project.gitProviderId) ||
    Boolean(project.gitInstallationId);
  const repositoryPreparation = readRepositoryPreparationConfig(
    asRecord(project.config).repositoryPreparation
  );

  return {
    ...(hasRepositorySource ? { deploymentSource: "git-repository" } : {}),
    repoFullName: project.repoFullName ?? undefined,
    repoUrl: project.repoUrl ?? undefined,
    gitProviderId: project.gitProviderId ?? undefined,
    gitInstallationId: project.gitInstallationId ?? undefined,
    branch: resolveProjectBranch(project),
    ...(hasRepositoryPreparation(repositoryPreparation) ? { repositoryPreparation } : {})
  };
}

export function buildComposeSourceSnapshot(input: ComposeSourceSnapshotInput): ConfigSnapshot {
  return {
    ...buildRepositorySourceSnapshot(input.project),
    composeFilePath: resolveComposeFilePath(input),
    ...(input.composeServiceName ? { composeServiceName: input.composeServiceName } : {})
  };
}

export function readComposeImageOverride(value: unknown): ComposeImageOverride | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return undefined;
  }

  const record = value as Record<string, unknown>;
  const serviceName = readNonEmptyString(record.serviceName);
  const imageReference = readNonEmptyString(record.imageReference);
  if (!serviceName || !imageReference) {
    return undefined;
  }

  return {
    serviceName,
    imageReference
  };
}

export function resolveComposeImageOverride(input: {
  serviceName: string;
  composeServiceName?: string | null;
  requestedImageTag?: string | null;
  effectiveImageTag?: string | null;
  serviceImageReference?: string | null;
  existingOverride?: unknown;
}): ComposeImageOverride | undefined {
  const requestedImageTag = readNonEmptyString(input.requestedImageTag);
  const targetImageReference =
    requestedImageTag ?? readNonEmptyString(input.effectiveImageTag) ?? undefined;
  if (!targetImageReference) {
    return undefined;
  }

  const overrideServiceName =
    readNonEmptyString(input.composeServiceName) ?? readNonEmptyString(input.serviceName);
  if (!overrideServiceName) {
    return undefined;
  }

  if (requestedImageTag) {
    return {
      serviceName: overrideServiceName,
      imageReference: targetImageReference
    };
  }

  const existingOverride = readComposeImageOverride(input.existingOverride);
  if (existingOverride) {
    return existingOverride;
  }

  const defaultImageReference = readNonEmptyString(input.serviceImageReference);
  if (defaultImageReference === targetImageReference) {
    return undefined;
  }

  return {
    serviceName: overrideServiceName,
    imageReference: targetImageReference
  };
}

export function extractReplayableConfigSnapshot(snapshot: Record<string, unknown>): ConfigSnapshot {
  const replayableEntries = Object.entries(snapshot).filter(
    ([key]) => !EXECUTION_ONLY_SNAPSHOT_KEYS.has(key)
  );

  return Object.fromEntries(replayableEntries) as ConfigSnapshot;
}
