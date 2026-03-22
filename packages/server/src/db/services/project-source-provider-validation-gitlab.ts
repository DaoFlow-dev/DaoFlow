import { readGitInstallationAccessToken, getGitInstallation } from "./git-providers";
import type {
  ProjectSourceValidationResult,
  ProviderLinkedProjectSource
} from "./project-source-readiness";
import {
  buildGitLabApiBaseUrl,
  fetchWithProviderTimeout,
  invalidResult,
  readyResult,
  type GitProviderValidationRecord
} from "./project-source-provider-validation-shared";

export async function validateGitLabSource(
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

  for (const composeFile of source.composeFiles) {
    const composeResponse = await fetchWithProviderTimeout(
      "gitlab",
      "compose file access",
      `${buildGitLabApiBaseUrl(provider.baseUrl)}/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(composeFile)}?ref=${encodeURIComponent(source.defaultBranch)}`,
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
        `Compose file ${composeFile} was not found in ${source.repoFullName}@${source.defaultBranch}.`,
        {
          repository: "ok",
          branch: "ok",
          composePath: "failed"
        }
      );
    }
  }

  return readyResult(source, "gitlab");
}
