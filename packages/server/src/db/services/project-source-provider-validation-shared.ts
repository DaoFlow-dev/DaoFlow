import { gitProviders } from "../schema/git-providers";
import type {
  ProjectSourceReadiness,
  ProjectSourceValidationResult,
  ProviderLinkedProjectSource
} from "./project-source-readiness";

export type ProviderValidationProviderType = "github" | "gitlab";

export type GitProviderValidationRecord = Pick<
  typeof gitProviders.$inferSelect,
  "id" | "type" | "name" | "baseUrl" | "appId" | "privateKeyEncrypted"
>;

const DEFAULT_PROVIDER_VALIDATION_TIMEOUT_MS = 10_000;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function providerLabel(providerType: ProviderValidationProviderType): string {
  return providerType === "github" ? "GitHub" : "GitLab";
}

export function buildGitHubApiBaseUrl(baseUrl: string | null): string {
  if (!baseUrl) {
    return "https://api.github.com";
  }

  const normalized = trimTrailingSlash(baseUrl);
  return normalized.includes("/api/") ? normalized : `${normalized}/api/v3`;
}

export function buildGitLabApiBaseUrl(baseUrl: string | null): string {
  if (!baseUrl) {
    return "https://gitlab.com/api/v4";
  }

  const normalized = trimTrailingSlash(baseUrl);
  return normalized.includes("/api/") ? normalized : `${normalized}/api/v4`;
}

export function getProviderValidationTimeoutMs(): number {
  const raw = Number(process.env.DAOFLOW_PROVIDER_VALIDATION_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }

  return DEFAULT_PROVIDER_VALIDATION_TIMEOUT_MS;
}

export function invalidReadiness(
  source: ProviderLinkedProjectSource,
  providerType: ProviderValidationProviderType,
  message: string,
  checks: ProjectSourceReadiness["checks"]
): ProjectSourceReadiness {
  return {
    status: "invalid",
    providerType,
    repoFullName: source.repoFullName,
    repoUrl: null,
    branch: source.defaultBranch,
    composePath: source.composePath,
    composeFiles: source.composeFiles,
    ...(source.composeProfiles.length > 0 ? { composeProfiles: source.composeProfiles } : {}),
    checkedAt: new Date().toISOString(),
    message,
    checks
  };
}

export function invalidResult(
  source: ProviderLinkedProjectSource,
  providerType: ProviderValidationProviderType,
  message: string,
  checks: ProjectSourceReadiness["checks"]
): ProjectSourceValidationResult {
  return {
    status: "invalid",
    message,
    readiness: invalidReadiness(source, providerType, message, checks)
  };
}

export function readyResult(
  source: ProviderLinkedProjectSource,
  providerType: ProviderValidationProviderType
): ProjectSourceValidationResult {
  return {
    status: "ready",
    source,
    readiness: {
      status: "ready",
      providerType,
      repoFullName: source.repoFullName,
      repoUrl: null,
      branch: source.defaultBranch,
      composePath: source.composePath,
      composeFiles: source.composeFiles,
      ...(source.composeProfiles.length > 0 ? { composeProfiles: source.composeProfiles } : {}),
      checkedAt: new Date().toISOString(),
      message: `Validated ${providerLabel(providerType)} repository source ${source.repoFullName}@${source.defaultBranch}.`,
      checks: {
        repository: "ok",
        branch: "ok",
        composePath: "ok"
      }
    }
  };
}

function providerUnavailableResult(
  providerType: ProviderValidationProviderType,
  message: string
): ProjectSourceValidationResult {
  return {
    status: "provider_unavailable",
    message: `${providerLabel(providerType)} source validation is temporarily unavailable: ${message}`
  };
}

function isAbortError(error: unknown): boolean {
  return error instanceof DOMException
    ? error.name === "AbortError" || error.name === "TimeoutError"
    : error instanceof Error && (error.name === "AbortError" || error.name === "TimeoutError");
}

function isTransientProviderStatus(status: number): boolean {
  return status === 408 || status === 429 || status >= 500;
}

function transientProviderMessage(input: {
  operation: string;
  responseStatus?: number;
  error?: unknown;
}): string {
  if (input.responseStatus === 429) {
    return `rate limited while checking ${input.operation}; retry later.`;
  }

  if (input.responseStatus !== undefined) {
    return `returned ${input.responseStatus} while checking ${input.operation}; retry when the provider is reachable.`;
  }

  if (isAbortError(input.error)) {
    return `timed out after ${getProviderValidationTimeoutMs()}ms while checking ${input.operation}; retry when the provider is reachable.`;
  }

  return `could not reach the provider while checking ${input.operation}; retry when the provider is reachable.`;
}

export async function fetchWithProviderTimeout(
  providerType: ProviderValidationProviderType,
  operation: string,
  url: string,
  init: RequestInit
): Promise<Response | ProjectSourceValidationResult> {
  try {
    const response = await fetch(url, {
      ...init,
      signal: AbortSignal.timeout(getProviderValidationTimeoutMs())
    });

    if (isTransientProviderStatus(response.status)) {
      return providerUnavailableResult(
        providerType,
        transientProviderMessage({
          operation,
          responseStatus: response.status
        })
      );
    }

    return response;
  } catch (error) {
    return providerUnavailableResult(
      providerType,
      transientProviderMessage({
        operation,
        error
      })
    );
  }
}
