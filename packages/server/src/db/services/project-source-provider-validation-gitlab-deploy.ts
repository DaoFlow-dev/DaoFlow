import type {
  ProjectSourceValidationResult,
  ProviderLinkedProjectSource
} from "./project-source-readiness";
import { materializeProjectSourceInspection } from "./project-source-checkout-inspection";
import { invalidResult, readyResult } from "./project-source-provider-validation-shared";
import { resolveProjectSourceWorkspaceFile } from "./project-source-workspace-files";

export async function validateGitLabDeployTokenSource(
  source: ProviderLinkedProjectSource,
  materialize: typeof materializeProjectSourceInspection = materializeProjectSourceInspection
): Promise<ProjectSourceValidationResult> {
  const inspection = await materialize({
    project: {
      teamId: source.teamId,
      repoUrl: null,
      repoFullName: source.repoFullName,
      gitProviderId: source.gitProviderId,
      gitInstallationId: source.gitInstallationId
    },
    branch: source.defaultBranch
  });
  if (inspection.status !== "ok") {
    return invalidResult(
      source,
      "gitlab",
      `GitLab deploy token could not reach ${source.repoFullName}@${source.defaultBranch}.`,
      { repository: "failed", branch: "skipped", composePath: "skipped" }
    );
  }

  try {
    for (const composeFile of source.composeFiles) {
      const file = resolveProjectSourceWorkspaceFile(inspection.workDir, composeFile);
      if (file.status !== "ok") {
        return invalidResult(
          source,
          "gitlab",
          `Compose file ${composeFile} was not found in ${source.repoFullName}@${source.defaultBranch}.`,
          { repository: "ok", branch: "ok", composePath: "failed" }
        );
      }
    }
    return readyResult(source, "gitlab");
  } finally {
    inspection.cleanup();
  }
}
