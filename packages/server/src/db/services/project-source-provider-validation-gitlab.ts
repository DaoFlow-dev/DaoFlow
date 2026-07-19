import { getGitInstallation } from "./git-providers";
import { resolveGitLabInstallationApiAccess } from "./gitlab-installation-auth";
import { resolveGitLabApiBaseUrl } from "./gitlab-urls";
import { validateGitLabDeployTokenSource } from "./project-source-provider-validation-gitlab-deploy";
import type {
  ProjectSourceValidationResult,
  ProviderLinkedProjectSource
} from "./project-source-readiness";
import {
  fetchWithProviderTimeout,
  invalidResult,
  readyResult,
  type GitProviderValidationRecord
} from "./project-source-provider-validation-shared";

export async function validateGitLabSource(
  provider: GitProviderValidationRecord,
  source: ProviderLinkedProjectSource
): Promise<ProjectSourceValidationResult> {
  const installation = await getGitInstallation(source.gitInstallationId, source.teamId);

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

  if (
    !installation ||
    installation.providerId !== source.gitProviderId ||
    installation.teamId !== source.teamId
  ) {
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

  const apiAccess = await resolveGitLabInstallationApiAccess({
    provider,
    installation
  });
  if (apiAccess.status === "capability_unavailable") {
    return validateGitLabDeployTokenSource(source);
  }
  if (apiAccess.status !== "ok") {
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

  const headers = apiAccess.headers;

  const projectResponse = await fetchWithProviderTimeout(
    provider,
    "gitlab",
    "repository access",
    `${resolveGitLabApiBaseUrl(provider)}/projects/${encodeURIComponent(source.repoFullName)}`,
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
    provider,
    "gitlab",
    "branch access",
    `${resolveGitLabApiBaseUrl(provider)}/projects/${encodeURIComponent(projectId)}/repository/branches/${encodeURIComponent(source.defaultBranch)}`,
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
      provider,
      "gitlab",
      "compose file access",
      `${resolveGitLabApiBaseUrl(provider)}/projects/${encodeURIComponent(projectId)}/repository/files/${encodeURIComponent(composeFile)}?ref=${encodeURIComponent(source.defaultBranch)}`,
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
