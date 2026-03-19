import { createSign } from "node:crypto";
import { gitProviders } from "../schema/git-providers";
import { decrypt } from "../crypto";
import { getGitInstallation, readGitInstallationAccessToken } from "./git-providers";
import type {
  ProjectSourceReadiness,
  ProjectSourceValidationResult,
  ProviderLinkedProjectSource
} from "./project-source-readiness";

type GitProviderValidationRecord = Pick<
  typeof gitProviders.$inferSelect,
  "id" | "type" | "name" | "baseUrl" | "appId" | "privateKeyEncrypted"
>;

const DEFAULT_PROVIDER_VALIDATION_TIMEOUT_MS = 10_000;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function providerLabel(providerType: "github" | "gitlab"): string {
  return providerType === "github" ? "GitHub" : "GitLab";
}

function getProviderValidationTimeoutMs(): number {
  const raw = Number(process.env.DAOFLOW_PROVIDER_VALIDATION_TIMEOUT_MS);
  if (Number.isFinite(raw) && raw > 0) {
    return raw;
  }

  return DEFAULT_PROVIDER_VALIDATION_TIMEOUT_MS;
}

function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function toBase64Url(value: string): string {
  return toBase64(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeGitHubRepoPath(repoFullName: string): string {
  return repoFullName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildGitHubApiBaseUrl(baseUrl: string | null): string {
  if (!baseUrl) {
    return "https://api.github.com";
  }

  const normalized = trimTrailingSlash(baseUrl);
  return normalized.includes("/api/") ? normalized : `${normalized}/api/v3`;
}

function buildGitLabApiBaseUrl(baseUrl: string | null): string {
  if (!baseUrl) {
    return "https://gitlab.com/api/v4";
  }

  const normalized = trimTrailingSlash(baseUrl);
  return normalized.includes("/api/") ? normalized : `${normalized}/api/v4`;
}

function createGitHubAppJwt(appId: string, privateKeyPem: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 600,
      iss: appId
    })
  );

  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer
    .sign(privateKeyPem, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${signature}`;
}

function invalidReadiness(
  source: ProviderLinkedProjectSource,
  providerType: "github" | "gitlab",
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
    checkedAt: new Date().toISOString(),
    message,
    checks
  };
}

function invalidResult(
  source: ProviderLinkedProjectSource,
  providerType: "github" | "gitlab",
  message: string,
  checks: ProjectSourceReadiness["checks"]
): ProjectSourceValidationResult {
  return {
    status: "invalid",
    message,
    readiness: invalidReadiness(source, providerType, message, checks)
  };
}

function providerUnavailableResult(
  providerType: "github" | "gitlab",
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
  providerType: "github" | "gitlab";
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

async function fetchWithProviderTimeout(
  providerType: "github" | "gitlab",
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
          providerType,
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
        providerType,
        operation,
        error
      })
    );
  }
}

async function validateGitHubSource(
  provider: GitProviderValidationRecord,
  source: ProviderLinkedProjectSource
): Promise<ProjectSourceValidationResult> {
  const installation = await getGitInstallation(source.gitInstallationId);

  if (provider.type !== "github") {
    return invalidResult(
      source,
      "github",
      `Git provider ${source.gitProviderId} is not a GitHub provider.`,
      {
        repository: "failed",
        branch: "skipped",
        composePath: "skipped"
      }
    );
  }

  if (!installation || installation.providerId !== source.gitProviderId) {
    return invalidResult(
      source,
      "github",
      `Git installation ${source.gitInstallationId} was not found for provider ${source.gitProviderId}.`,
      {
        repository: "failed",
        branch: "skipped",
        composePath: "skipped"
      }
    );
  }

  if (!provider.appId || !provider.privateKeyEncrypted) {
    return invalidResult(
      source,
      "github",
      `GitHub provider ${provider.name} is missing app credentials.`,
      {
        repository: "failed",
        branch: "skipped",
        composePath: "skipped"
      }
    );
  }

  const jwt = createGitHubAppJwt(provider.appId, decrypt(provider.privateKeyEncrypted));
  const authHeaders = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${jwt}`,
    "User-Agent": "DaoFlow"
  };

  const tokenResponse = await fetchWithProviderTimeout(
    "github",
    "installation token exchange",
    `${buildGitHubApiBaseUrl(provider.baseUrl)}/app/installations/${installation.installationId}/access_tokens`,
    {
      method: "POST",
      headers: authHeaders
    }
  );
  if (!(tokenResponse instanceof Response)) {
    return tokenResponse;
  }

  if (!tokenResponse.ok) {
    return invalidResult(
      source,
      "github",
      `GitHub installation token exchange failed with status ${tokenResponse.status}.`,
      {
        repository: "failed",
        branch: "skipped",
        composePath: "skipped"
      }
    );
  }

  const tokenData = (await tokenResponse.json()) as { token?: string };
  if (!tokenData.token) {
    return invalidResult(
      source,
      "github",
      "GitHub installation token exchange did not return a token.",
      {
        repository: "failed",
        branch: "skipped",
        composePath: "skipped"
      }
    );
  }

  const repoPath = encodeGitHubRepoPath(source.repoFullName);
  const repoHeaders = {
    Accept: "application/vnd.github+json",
    Authorization: `Bearer ${tokenData.token}`,
    "User-Agent": "DaoFlow"
  };

  const repositoryResponse = await fetchWithProviderTimeout(
    "github",
    "repository access",
    `${buildGitHubApiBaseUrl(provider.baseUrl)}/repos/${repoPath}`,
    {
      headers: repoHeaders
    }
  );
  if (!(repositoryResponse instanceof Response)) {
    return repositoryResponse;
  }
  if (!repositoryResponse.ok) {
    return invalidResult(
      source,
      "github",
      `Repository ${source.repoFullName} is not accessible through the GitHub installation.`,
      {
        repository: "failed",
        branch: "skipped",
        composePath: "skipped"
      }
    );
  }

  const branchResponse = await fetchWithProviderTimeout(
    "github",
    "branch access",
    `${buildGitHubApiBaseUrl(provider.baseUrl)}/repos/${repoPath}/branches/${encodeURIComponent(source.defaultBranch)}`,
    {
      headers: repoHeaders
    }
  );
  if (!(branchResponse instanceof Response)) {
    return branchResponse;
  }
  if (!branchResponse.ok) {
    return invalidResult(
      source,
      "github",
      `Branch ${source.defaultBranch} was not found in ${source.repoFullName}.`,
      {
        repository: "ok",
        branch: "failed",
        composePath: "skipped"
      }
    );
  }

  const composeResponse = await fetchWithProviderTimeout(
    "github",
    "compose file access",
    `${buildGitHubApiBaseUrl(provider.baseUrl)}/repos/${repoPath}/contents/${encodeURIComponent(source.composePath)}?ref=${encodeURIComponent(source.defaultBranch)}`,
    {
      headers: repoHeaders
    }
  );
  if (!(composeResponse instanceof Response)) {
    return composeResponse;
  }
  if (!composeResponse.ok) {
    return invalidResult(
      source,
      "github",
      `Compose file ${source.composePath} was not found in ${source.repoFullName}@${source.defaultBranch}.`,
      {
        repository: "ok",
        branch: "ok",
        composePath: "failed"
      }
    );
  }

  return {
    status: "ready",
    source,
    readiness: {
      status: "ready",
      providerType: "github",
      repoFullName: source.repoFullName,
      repoUrl: null,
      branch: source.defaultBranch,
      composePath: source.composePath,
      checkedAt: new Date().toISOString(),
      message: `Validated GitHub repository source ${source.repoFullName}@${source.defaultBranch}.`,
      checks: {
        repository: "ok",
        branch: "ok",
        composePath: "ok"
      }
    }
  };
}

async function validateGitLabSource(
  provider: GitProviderValidationRecord,
  source: ProviderLinkedProjectSource
): Promise<ProjectSourceValidationResult> {
  const installation = await getGitInstallation(source.gitInstallationId);

  if (provider.type !== "gitlab") {
    return invalidResult(
      source,
      "gitlab",
      `Git provider ${source.gitProviderId} is not a GitLab provider.`,
      {
        repository: "failed",
        branch: "skipped",
        composePath: "skipped"
      }
    );
  }

  if (!installation || installation.providerId !== source.gitProviderId) {
    return invalidResult(
      source,
      "gitlab",
      `Git installation ${source.gitInstallationId} was not found for provider ${source.gitProviderId}.`,
      {
        repository: "failed",
        branch: "skipped",
        composePath: "skipped"
      }
    );
  }

  const accessToken = readGitInstallationAccessToken(installation);
  if (!accessToken) {
    return invalidResult(
      source,
      "gitlab",
      `GitLab installation ${source.gitInstallationId} does not have a usable access token.`,
      {
        repository: "failed",
        branch: "skipped",
        composePath: "skipped"
      }
    );
  }

  const headers = {
    Authorization: `Bearer ${accessToken}`
  };

  const projectResponse = await fetchWithProviderTimeout(
    "gitlab",
    "repository access",
    `${buildGitLabApiBaseUrl(provider.baseUrl)}/projects/${encodeURIComponent(source.repoFullName)}`,
    {
      headers
    }
  );
  if (!(projectResponse instanceof Response)) {
    return projectResponse;
  }
  if (!projectResponse.ok) {
    return invalidResult(
      source,
      "gitlab",
      `Repository ${source.repoFullName} is not accessible through the GitLab installation.`,
      {
        repository: "failed",
        branch: "skipped",
        composePath: "skipped"
      }
    );
  }

  const projectData = (await projectResponse.json()) as { id?: number | string };
  if (!projectData.id) {
    return invalidResult(
      source,
      "gitlab",
      `GitLab repository ${source.repoFullName} did not return a project identifier.`,
      {
        repository: "failed",
        branch: "skipped",
        composePath: "skipped"
      }
    );
  }

  const projectId = String(projectData.id);
  const branchResponse = await fetchWithProviderTimeout(
    "gitlab",
    "branch access",
    `${buildGitLabApiBaseUrl(provider.baseUrl)}/projects/${encodeURIComponent(projectId)}/repository/branches/${encodeURIComponent(source.defaultBranch)}`,
    {
      headers
    }
  );
  if (!(branchResponse instanceof Response)) {
    return branchResponse;
  }
  if (!branchResponse.ok) {
    return invalidResult(
      source,
      "gitlab",
      `Branch ${source.defaultBranch} was not found in ${source.repoFullName}.`,
      {
        repository: "ok",
        branch: "failed",
        composePath: "skipped"
      }
    );
  }

  const composeResponse = await fetchWithProviderTimeout(
    "gitlab",
    "compose file access",
    `${buildGitLabApiBaseUrl(provider.baseUrl)}/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(source.composePath)}?ref=${encodeURIComponent(source.defaultBranch)}`,
    {
      headers
    }
  );
  if (!(composeResponse instanceof Response)) {
    return composeResponse;
  }
  if (!composeResponse.ok) {
    return invalidResult(
      source,
      "gitlab",
      `Compose file ${source.composePath} was not found in ${source.repoFullName}@${source.defaultBranch}.`,
      {
        repository: "ok",
        branch: "ok",
        composePath: "failed"
      }
    );
  }

  return {
    status: "ready",
    source,
    readiness: {
      status: "ready",
      providerType: "gitlab",
      repoFullName: source.repoFullName,
      repoUrl: null,
      branch: source.defaultBranch,
      composePath: source.composePath,
      checkedAt: new Date().toISOString(),
      message: `Validated GitLab repository source ${source.repoFullName}@${source.defaultBranch}.`,
      checks: {
        repository: "ok",
        branch: "ok",
        composePath: "ok"
      }
    }
  };
}

export async function validateProviderLinkedProjectSource(
  provider: GitProviderValidationRecord,
  source: ProviderLinkedProjectSource
): Promise<ProjectSourceValidationResult> {
  if (provider.type === "github") {
    return validateGitHubSource(provider, source);
  }

  if (provider.type === "gitlab") {
    return validateGitLabSource(provider, source);
  }

  return {
    status: "invalid",
    message: `Unsupported git provider type: ${provider.type}`,
    readiness: null
  };
}
