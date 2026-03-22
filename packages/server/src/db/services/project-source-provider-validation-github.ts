import { createSign } from "node:crypto";
import { decrypt } from "../crypto";
import { getGitInstallation } from "./git-providers";
import type {
  ProjectSourceValidationResult,
  ProviderLinkedProjectSource
} from "./project-source-readiness";
import {
  buildGitHubApiBaseUrl,
  fetchWithProviderTimeout,
  invalidResult,
  readyResult,
  type GitProviderValidationRecord
} from "./project-source-provider-validation-shared";

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

export async function validateGitHubSource(
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

  for (const composeFile of source.composeFiles) {
    const composeResponse = await fetchWithProviderTimeout(
      "github",
      "compose file access",
      `${buildGitHubApiBaseUrl(provider.baseUrl)}/repos/${repoPath}/contents/${encodeURIComponent(composeFile)}?ref=${encodeURIComponent(source.defaultBranch)}`,
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
        `Compose file ${composeFile} was not found in ${source.repoFullName}@${source.defaultBranch}.`,
        {
          repository: "ok",
          branch: "ok",
          composePath: "failed"
        }
      );
    }
  }

  return readyResult(source, "github");
}
