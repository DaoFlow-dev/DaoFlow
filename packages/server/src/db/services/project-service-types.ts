import type { AppRole } from "@daoflow/shared";

export interface CreateProjectInput {
  name: string;
  description?: string;
  repoUrl?: string;
  repoFullName?: string;
  composePath?: string;
  composeFiles?: string[];
  composeProfiles?: string[];
  gitProviderId?: string;
  gitInstallationId?: string;
  defaultBranch?: string;
  autoDeploy?: boolean;
  autoDeployBranch?: string;
  webhookWatchedPaths?: string[];
  repositorySubmodules?: boolean;
  repositoryGitLfs?: boolean;
  teamId: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface UpdateProjectInput {
  projectId: string;
  teamId?: string;
  name?: string;
  description?: string;
  repoUrl?: string;
  repoFullName?: string;
  composePath?: string;
  composeFiles?: string[];
  composeProfiles?: string[];
  gitProviderId?: string;
  gitInstallationId?: string;
  defaultBranch?: string;
  autoDeploy?: boolean;
  autoDeployBranch?: string;
  webhookWatchedPaths?: string[];
  repositorySubmodules?: boolean;
  repositoryGitLfs?: boolean;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface DeleteProjectInput {
  projectId: string;
  teamId?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface CreateEnvironmentInput {
  projectId: string;
  teamId?: string;
  name: string;
  targetServerId?: string;
  composeFiles?: string[];
  composeProfiles?: string[];
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface UpdateEnvironmentInput {
  environmentId: string;
  teamId?: string;
  name?: string;
  status?: string;
  targetServerId?: string;
  composeFiles?: string[];
  composeProfiles?: string[];
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}

export interface DeleteEnvironmentInput {
  environmentId: string;
  teamId?: string;
  requestedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}
