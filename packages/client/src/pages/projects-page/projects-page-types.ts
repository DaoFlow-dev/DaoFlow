export interface NewProjectDraft {
  name: string;
  description: string;
  repoUrl: string;
  gitProviderId: string;
  gitInstallationId: string;
  repoFullName: string;
  defaultBranch: string;
  autoDeploy: string;
  autoDeployBranch: string;
  composePath: string;
  repositoryCredentialKind: "none" | "https_token" | "https_basic" | "ssh_key";
  repositoryCredentialUsername: string;
  repositoryCredentialToken: string;
  repositoryCredentialPassword: string;
  repositoryCredentialPrivateKey: string;
}

export interface ProjectsPageProject {
  id: string | number;
  name: string;
  createdAt?: string | null;
  sourceType?: string | null;
  status: string;
  repoFullName?: string | null;
  repoUrl?: string | null;
  environmentCount?: number | null;
  serviceCount?: number | null;
  defaultBranch?: string | null;
}

export type ProjectsSortBy = "name" | "recent";
