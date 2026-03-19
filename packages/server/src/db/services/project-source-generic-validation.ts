import { existsSync } from "node:fs";
import { join } from "node:path";
import {
  materializeProjectSourceInspection,
  type ProjectSourceInspectionProject
} from "./project-source-checkout-inspection";
import type {
  GenericGitProjectSource,
  ProjectSourceReadiness,
  ProjectSourceValidationResult
} from "./project-source-readiness";

function describeGenericSource(source: GenericGitProjectSource): string {
  return source.repoFullName ?? source.repoUrl;
}

function isLocalRepositoryReference(repoUrl: string): boolean {
  return repoUrl.startsWith("/") || repoUrl.startsWith("./") || repoUrl.startsWith("../");
}

function buildGenericReadiness(
  source: GenericGitProjectSource,
  status: "ready" | "invalid",
  message: string,
  checks: ProjectSourceReadiness["checks"]
): ProjectSourceReadiness {
  return {
    status,
    providerType: "generic-git",
    repoFullName: source.repoFullName,
    repoUrl: source.repoUrl,
    branch: source.defaultBranch,
    composePath: source.composePath,
    checkedAt: new Date().toISOString(),
    message,
    checks
  };
}

export async function validateGenericGitProjectSource(
  source: GenericGitProjectSource,
  mode: "best-effort" | "strict"
): Promise<ProjectSourceValidationResult> {
  if (mode === "best-effort" && !isLocalRepositoryReference(source.repoUrl)) {
    return { status: "skipped" };
  }

  const inspection = await materializeProjectSourceInspection({
    project: {
      repoUrl: source.repoUrl,
      repoFullName: source.repoFullName,
      repositoryPreparation: source.repositoryPreparation
    } satisfies ProjectSourceInspectionProject,
    branch: source.defaultBranch
  });

  if (inspection.status !== "ok") {
    if (mode === "best-effort") {
      return { status: "skipped" };
    }

    const message = `Repository ${source.repoUrl} could not be cloned for branch ${source.defaultBranch}. Verify the repository URL, branch, and credentials.`;
    return {
      status: "invalid",
      message,
      readiness: buildGenericReadiness(source, "invalid", message, {
        repository: "failed",
        branch: "skipped",
        composePath: "skipped"
      })
    };
  }

  try {
    const composeFilePath = join(inspection.workDir, source.composePath);
    if (!existsSync(composeFilePath)) {
      const message = `Compose file ${source.composePath} was not found in ${describeGenericSource(source)}@${source.defaultBranch}.`;
      return {
        status: "invalid",
        message,
        readiness: buildGenericReadiness(source, "invalid", message, {
          repository: "ok",
          branch: "ok",
          composePath: "failed"
        })
      };
    }

    const message = `Validated generic git repository source ${describeGenericSource(source)}@${source.defaultBranch}.`;
    return {
      status: "ready",
      source,
      readiness: buildGenericReadiness(source, "ready", message, {
        repository: "ok",
        branch: "ok",
        composePath: "ok"
      })
    };
  } finally {
    inspection.cleanup();
  }
}
