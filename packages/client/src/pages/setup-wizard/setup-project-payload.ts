import type { SetupProjectFormData } from "./setup-wizard-types";

export function buildSetupProjectPayload(projectForm: SetupProjectFormData) {
  const gitProviderId =
    projectForm.gitProviderId !== "none" ? projectForm.gitProviderId.trim() : "";
  const gitInstallationId =
    projectForm.gitInstallationId !== "none" ? projectForm.gitInstallationId.trim() : "";

  return {
    name: projectForm.name.trim(),
    description: projectForm.description.trim() || undefined,
    repoUrl: projectForm.repoUrl.trim() || undefined,
    ...(gitProviderId ? { gitProviderId } : {}),
    ...(gitInstallationId ? { gitInstallationId } : {}),
    ...(projectForm.repoFullName.trim() ? { repoFullName: projectForm.repoFullName.trim() } : {}),
    ...(projectForm.defaultBranch.trim()
      ? { defaultBranch: projectForm.defaultBranch.trim() }
      : {}),
    ...(projectForm.composePath.trim() ? { composePath: projectForm.composePath.trim() } : {}),
    ...(projectForm.autoDeploy === "true" ? { autoDeploy: true } : {}),
    ...(projectForm.autoDeployBranch.trim()
      ? { autoDeployBranch: projectForm.autoDeployBranch.trim() }
      : {})
  };
}
