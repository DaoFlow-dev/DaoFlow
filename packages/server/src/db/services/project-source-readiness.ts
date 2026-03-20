import { eq } from "drizzle-orm";
import { db } from "../connection";
import { gitProviders } from "../schema/git-providers";
import { asRecord } from "./json-helpers";
import {
  normalizeComposeFilePath,
  normalizeComposeFilePaths,
  normalizeComposeProfiles
} from "../../compose-source";
import { validateGenericGitProjectSource } from "./project-source-generic-validation";
import { validateProviderLinkedProjectSource } from "./project-source-provider-validation";

export type ProjectSourceProviderType = "github" | "gitlab" | "generic-git";

export interface ProjectSourceReadiness {
  status: "ready" | "invalid";
  providerType: ProjectSourceProviderType;
  repoFullName: string | null;
  repoUrl: string | null;
  branch: string;
  composePath: string;
  composeFiles?: string[];
  composeProfiles?: string[];
  checkedAt: string;
  message: string;
  checks: {
    repository: "ok" | "failed";
    branch: "ok" | "failed" | "skipped";
    composePath: "ok" | "failed" | "skipped";
  };
}

export interface ProviderLinkedProjectSource {
  repoFullName: string;
  gitProviderId: string;
  gitInstallationId: string;
  defaultBranch: string;
  composePath: string;
  composeFiles: string[];
  composeProfiles: string[];
}

export interface GenericGitProjectSource {
  repoUrl: string;
  repoFullName: string | null;
  defaultBranch: string;
  composePath: string;
  composeFiles: string[];
  composeProfiles: string[];
  repositoryPreparation?: unknown;
}

export type ProjectSourceValidationResult =
  | {
      status: "ready";
      source: ProviderLinkedProjectSource | GenericGitProjectSource;
      readiness: ProjectSourceReadiness;
    }
  | {
      status: "invalid";
      message: string;
      readiness: ProjectSourceReadiness | null;
    }
  | {
      status: "provider_unavailable";
      message: string;
    }
  | {
      status: "skipped";
    };

type SourceValidationInput = {
  repoUrl?: string | null;
  repoFullName?: string | null;
  gitProviderId?: string | null;
  gitInstallationId?: string | null;
  defaultBranch?: string | null;
  composePath?: string | null;
  composeFiles?: string[] | null;
  composeProfiles?: string[] | null;
  repositoryPreparation?: unknown;
  genericGitMode?: "best-effort" | "strict";
};

type ProjectSourceReadinessRecord = Record<string, unknown> & {
  status?: unknown;
  providerType?: unknown;
  repoFullName?: unknown;
  repoUrl?: unknown;
  branch?: unknown;
  composePath?: unknown;
  composeFiles?: unknown;
  composeProfiles?: unknown;
  checkedAt?: unknown;
  message?: unknown;
  checks?: unknown;
};

function normalizeRepoFullName(
  repoFullName: string | null | undefined
): { status: "ok"; value: string } | { status: "invalid"; message: string } {
  const segments = (repoFullName ?? "").split("/").map((segment) => segment.trim());

  if (
    segments.length < 2 ||
    segments.some((segment) => !segment || segment === "." || segment === "..")
  ) {
    return {
      status: "invalid",
      message:
        "Provider-linked repository sources require repoFullName as a normalized slash-delimited repository path."
    };
  }

  return {
    status: "ok",
    value: segments.join("/")
  };
}

function isProviderLinkedSourceCandidate(input: SourceValidationInput): boolean {
  return Boolean(
    input.gitProviderId || input.gitInstallationId || (input.repoFullName && !input.repoUrl?.trim())
  );
}

function isGenericGitSourceCandidate(input: SourceValidationInput): boolean {
  return Boolean(input.repoUrl?.trim()) && !input.gitProviderId && !input.gitInstallationId;
}

function toProviderLinkedSource(
  input: SourceValidationInput
): { status: "ok"; source: ProviderLinkedProjectSource } | { status: "invalid"; message: string } {
  const gitProviderId = input.gitProviderId?.trim() ?? "";
  const gitInstallationId = input.gitInstallationId?.trim() ?? "";

  if (!input.repoFullName || !gitProviderId || !gitInstallationId) {
    return {
      status: "invalid",
      message:
        "Provider-linked repository sources require repoFullName, gitProviderId, and gitInstallationId."
    };
  }

  const repoFullName = normalizeRepoFullName(input.repoFullName);
  if (repoFullName.status === "invalid") {
    return repoFullName;
  }

  const composeFiles = normalizeComposeFilePaths({
    composeFiles: input.composeFiles,
    composePath: input.composePath
  });
  const composePath = composeFiles[0] ?? normalizeComposeFilePath(input.composePath);
  if (composePath === ".." || composePath.startsWith("../")) {
    return {
      status: "invalid",
      message: "Compose paths must stay within the repository root."
    };
  }
  if (composeFiles.some((file) => file === ".." || file.startsWith("../"))) {
    return {
      status: "invalid",
      message: "Compose paths must stay within the repository root."
    };
  }

  return {
    status: "ok",
    source: {
      repoFullName: repoFullName.value,
      gitProviderId,
      gitInstallationId,
      defaultBranch: input.defaultBranch?.trim() || "main",
      composePath,
      composeFiles,
      composeProfiles: normalizeComposeProfiles(input.composeProfiles)
    }
  };
}

function normalizeRepoUrl(
  repoUrl: string | null | undefined
): { status: "ok"; value: string } | { status: "invalid"; message: string } {
  const normalized = repoUrl?.trim() ?? "";
  if (!normalized) {
    return {
      status: "invalid",
      message: "Generic git repository sources require a non-empty repoUrl."
    };
  }

  return {
    status: "ok",
    value: normalized
  };
}

function toGenericGitSource(
  input: SourceValidationInput
): { status: "ok"; source: GenericGitProjectSource } | { status: "invalid"; message: string } {
  const repoUrl = normalizeRepoUrl(input.repoUrl);
  if (repoUrl.status === "invalid") {
    return repoUrl;
  }

  const composeFiles = normalizeComposeFilePaths({
    composeFiles: input.composeFiles,
    composePath: input.composePath
  });
  const composePath = composeFiles[0] ?? normalizeComposeFilePath(input.composePath);
  if (composePath === ".." || composePath.startsWith("../")) {
    return {
      status: "invalid",
      message: "Compose paths must stay within the repository root."
    };
  }
  if (composeFiles.some((file) => file === ".." || file.startsWith("../"))) {
    return {
      status: "invalid",
      message: "Compose paths must stay within the repository root."
    };
  }

  return {
    status: "ok",
    source: {
      repoUrl: repoUrl.value,
      repoFullName: input.repoFullName?.trim() || null,
      defaultBranch: input.defaultBranch?.trim() || "main",
      composePath,
      composeFiles,
      composeProfiles: normalizeComposeProfiles(input.composeProfiles),
      repositoryPreparation: input.repositoryPreparation
    }
  };
}

export async function validateProjectSourceReadiness(
  input: SourceValidationInput
): Promise<ProjectSourceValidationResult> {
  if (isProviderLinkedSourceCandidate(input)) {
    const sourceResult = toProviderLinkedSource(input);
    if (sourceResult.status === "invalid") {
      return {
        status: "invalid",
        message: sourceResult.message,
        readiness: null
      };
    }

    const [provider] = await db
      .select()
      .from(gitProviders)
      .where(eq(gitProviders.id, sourceResult.source.gitProviderId))
      .limit(1);

    if (!provider) {
      return {
        status: "invalid",
        message: `Git provider ${sourceResult.source.gitProviderId} was not found.`,
        readiness: null
      };
    }

    return validateProviderLinkedProjectSource(provider, sourceResult.source);
  }

  if (isGenericGitSourceCandidate(input)) {
    const sourceResult = toGenericGitSource(input);
    if (sourceResult.status === "invalid") {
      return {
        status: "invalid",
        message: sourceResult.message,
        readiness: null
      };
    }

    return validateGenericGitProjectSource(sourceResult.source, input.genericGitMode ?? "strict");
  }

  return { status: "skipped" };
}

export function mergeProjectSourceReadiness(
  config: unknown,
  readiness: ProjectSourceReadiness | null
): Record<string, unknown> {
  const next = { ...asRecord(config) };
  if (readiness) {
    next.sourceReadiness = readiness;
  } else {
    delete next.sourceReadiness;
  }
  return next;
}

export function readProjectSourceReadiness(config: unknown): ProjectSourceReadiness | null {
  const record = asRecord(config).sourceReadiness;
  if (!record || typeof record !== "object" || Array.isArray(record)) {
    return null;
  }

  const sourceReadiness = record as ProjectSourceReadinessRecord;
  const checksRecord = asRecord(sourceReadiness.checks);
  if (
    (sourceReadiness.status !== "ready" && sourceReadiness.status !== "invalid") ||
    (sourceReadiness.providerType !== "github" &&
      sourceReadiness.providerType !== "gitlab" &&
      sourceReadiness.providerType !== "generic-git") ||
    typeof sourceReadiness.branch !== "string" ||
    typeof sourceReadiness.composePath !== "string" ||
    typeof sourceReadiness.checkedAt !== "string" ||
    typeof sourceReadiness.message !== "string"
  ) {
    return null;
  }

  const repoFullName =
    typeof sourceReadiness.repoFullName === "string" ? sourceReadiness.repoFullName : null;
  const repoUrl = typeof sourceReadiness.repoUrl === "string" ? sourceReadiness.repoUrl : null;
  const composeFiles = normalizeComposeFilePaths({
    composeFiles: Array.isArray(sourceReadiness.composeFiles)
      ? sourceReadiness.composeFiles.filter((entry): entry is string => typeof entry === "string")
      : undefined,
    composePath: sourceReadiness.composePath
  });
  const composeProfiles = normalizeComposeProfiles(
    Array.isArray(sourceReadiness.composeProfiles)
      ? sourceReadiness.composeProfiles.filter(
          (entry): entry is string => typeof entry === "string"
        )
      : []
  );

  if (sourceReadiness.providerType === "generic-git" && !repoUrl) {
    return null;
  }

  if (sourceReadiness.providerType !== "generic-git" && !repoFullName) {
    return null;
  }

  const repository = checksRecord.repository;
  const branch = checksRecord.branch;
  const composePath = checksRecord.composePath;

  if (
    (repository !== "ok" && repository !== "failed") ||
    (branch !== "ok" && branch !== "failed" && branch !== "skipped") ||
    (composePath !== "ok" && composePath !== "failed" && composePath !== "skipped")
  ) {
    return null;
  }

  return {
    status: sourceReadiness.status,
    providerType: sourceReadiness.providerType,
    repoFullName,
    repoUrl,
    branch: sourceReadiness.branch,
    composePath: sourceReadiness.composePath,
    composeFiles,
    ...(composeProfiles.length > 0 ? { composeProfiles } : {}),
    checkedAt: sourceReadiness.checkedAt,
    message: sourceReadiness.message,
    checks: {
      repository,
      branch,
      composePath
    }
  };
}
