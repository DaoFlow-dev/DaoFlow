import { basename, isAbsolute, posix } from "node:path";
import { eq } from "drizzle-orm";
import { db } from "../connection";
import { gitProviders } from "../schema/git-providers";
import { asRecord } from "./json-helpers";
import { validateProviderLinkedProjectSource } from "./project-source-provider-validation";

export interface ProjectSourceReadiness {
  status: "ready" | "invalid";
  providerType: "github" | "gitlab";
  repoFullName: string;
  branch: string;
  composePath: string;
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
}

export type ProjectSourceValidationResult =
  | {
      status: "ready";
      source: ProviderLinkedProjectSource;
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
  repoFullName?: string | null;
  gitProviderId?: string | null;
  gitInstallationId?: string | null;
  defaultBranch?: string | null;
  composePath?: string | null;
};

type ProjectSourceReadinessRecord = Record<string, unknown> & {
  status?: unknown;
  providerType?: unknown;
  repoFullName?: unknown;
  branch?: unknown;
  composePath?: unknown;
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

function normalizeComposePath(composePath: string | null | undefined): string {
  const raw = composePath?.trim() ?? "";
  if (!raw) {
    return "docker-compose.yml";
  }

  const maybeAbsolute = raw.replace(/\\/g, "/");
  const relative = isAbsolute(maybeAbsolute) ? basename(maybeAbsolute) : maybeAbsolute;
  const normalized = posix.normalize(relative).replace(/^(\.\/)+/, "");

  return !normalized || normalized === "." ? "docker-compose.yml" : normalized;
}

function isProviderLinkedSourceCandidate(input: SourceValidationInput): boolean {
  return Boolean(input.repoFullName || input.gitProviderId || input.gitInstallationId);
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

  const composePath = normalizeComposePath(input.composePath);
  if (composePath === ".." || composePath.startsWith("../")) {
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
      composePath
    }
  };
}

export async function validateProjectSourceReadiness(
  input: SourceValidationInput
): Promise<ProjectSourceValidationResult> {
  if (!isProviderLinkedSourceCandidate(input)) {
    return { status: "skipped" };
  }

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
    (sourceReadiness.providerType !== "github" && sourceReadiness.providerType !== "gitlab") ||
    typeof sourceReadiness.repoFullName !== "string" ||
    typeof sourceReadiness.branch !== "string" ||
    typeof sourceReadiness.composePath !== "string" ||
    typeof sourceReadiness.checkedAt !== "string" ||
    typeof sourceReadiness.message !== "string"
  ) {
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
    repoFullName: sourceReadiness.repoFullName,
    branch: sourceReadiness.branch,
    composePath: sourceReadiness.composePath,
    checkedAt: sourceReadiness.checkedAt,
    message: sourceReadiness.message,
    checks: {
      repository,
      branch,
      composePath
    }
  };
}
