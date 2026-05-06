export type SetupStep = "welcome" | "account" | "server" | "project" | "environment" | "handoff";

export interface SetupServerFormData {
  name: string;
  host: string;
  sshPort: string;
  region: string;
  sshUser: string;
  sshPrivateKey: string;
}

export interface SetupProjectFormData {
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
}

export interface SetupEnvironmentFormData {
  name: string;
  targetServerId: string;
}

export interface SetupServerOption {
  id: string;
  name: string;
  host: string;
  targetKind: string;
}
