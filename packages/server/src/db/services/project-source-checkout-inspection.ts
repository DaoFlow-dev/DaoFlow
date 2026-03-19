import { randomBytes } from "node:crypto";
import { cleanupStagingDir, gitClone } from "../../worker/git-executor";
import { resolveCheckoutSpec } from "../../worker/checkout-source";
import type { ConfigSnapshot } from "../../worker/step-management";
import type { OnLog } from "../../worker/docker-executor";
import { readRepositoryPreparationConfig } from "../../repository-preparation";

export interface ProjectSourceInspectionProject {
  repoUrl: string | null;
  repoFullName?: string | null;
  gitProviderId?: string | null;
  gitInstallationId?: string | null;
  repositoryPreparation?: unknown;
}

type ProjectSourceInspectionResult =
  | {
      status: "ok";
      workDir: string;
      cleanup: () => void;
    }
  | {
      status: "not_available";
      reason: string;
    };

const noopLog: OnLog = () => undefined;

function newInspectionId(): string {
  return `gitinspect_${randomBytes(8).toString("hex")}`.slice(0, 32);
}

export async function materializeProjectSourceInspection(input: {
  project: ProjectSourceInspectionProject;
  branch: string;
}): Promise<ProjectSourceInspectionResult> {
  const repoUrl = input.project.repoUrl?.trim();
  if (!repoUrl) {
    return {
      status: "not_available",
      reason: "Project source does not define a usable repoUrl."
    };
  }

  const inspectionId = newInspectionId();

  try {
    const checkout = await resolveCheckoutSpec({
      repoUrl,
      repoFullName: input.project.repoFullName ?? undefined,
      gitProviderId: input.project.gitProviderId ?? undefined,
      gitInstallationId: input.project.gitInstallationId ?? undefined,
      branch: input.branch,
      repositoryPreparation: readRepositoryPreparationConfig(input.project.repositoryPreparation)
    } satisfies ConfigSnapshot);

    if (!checkout) {
      return {
        status: "not_available",
        reason: "Project source checkout configuration could not be resolved."
      };
    }

    const cloneResult = await gitClone(checkout.repoUrl, checkout.branch, inspectionId, noopLog, {
      displayLabel: checkout.displayLabel,
      gitConfig: checkout.gitConfig,
      repositoryPreparation: checkout.repositoryPreparation
    });
    if (cloneResult.exitCode !== 0) {
      cleanupStagingDir(inspectionId);
      return {
        status: "not_available",
        reason:
          cloneResult.errorMessage ?? `git clone failed with exit code ${cloneResult.exitCode}`
      };
    }

    return {
      status: "ok",
      workDir: cloneResult.workDir,
      cleanup: () => cleanupStagingDir(inspectionId)
    };
  } catch (error) {
    cleanupStagingDir(inspectionId);
    return {
      status: "not_available",
      reason: error instanceof Error ? error.message : String(error)
    };
  }
}
