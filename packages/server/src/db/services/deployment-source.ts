import { asRecord, readString } from "./json-helpers";
import type { ConfigSnapshot } from "../../worker/step-management";
import { basename, isAbsolute } from "node:path";

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

  return {
    ...(hasRepositorySource ? { deploymentSource: "git-repository" } : {}),
    repoFullName: project.repoFullName ?? undefined,
    repoUrl: project.repoUrl ?? undefined,
    gitProviderId: project.gitProviderId ?? undefined,
    gitInstallationId: project.gitInstallationId ?? undefined,
    branch: resolveProjectBranch(project)
  };
}

export function buildComposeSourceSnapshot(input: ComposeSourceSnapshotInput): ConfigSnapshot {
  return {
    ...buildRepositorySourceSnapshot(input.project),
    composeFilePath: resolveComposeFilePath(input),
    ...(input.composeServiceName ? { composeServiceName: input.composeServiceName } : {})
  };
}

export function extractReplayableConfigSnapshot(snapshot: Record<string, unknown>): ConfigSnapshot {
  const replayableEntries = Object.entries(snapshot).filter(
    ([key]) => !EXECUTION_ONLY_SNAPSHOT_KEYS.has(key)
  );

  return Object.fromEntries(replayableEntries) as ConfigSnapshot;
}
