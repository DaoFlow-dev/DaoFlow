export interface ProjectDetailProject {
  id: string;
  name: string;
  repoUrl: string | null;
  repoFullName: string | null;
  defaultBranch: string | null;
  autoDeploy: boolean;
  config?: unknown;
  environments?:
    | {
        id: string;
        name: string;
      }[]
    | null;
}

export interface ProjectDetailService {
  id: string;
  name: string;
  sourceType: string;
  imageReference: string | null;
  composeServiceName: string | null;
  dockerfilePath: string | null;
  status: string;
  statusTone?: string;
  statusLabel?: string;
  environmentId: string | null;
  runtimeSummary?: {
    statusTone: string;
    statusLabel: string;
    summary: string;
  };
  rolloutStrategy?: {
    label: string;
    downtimeRisk: string;
  };
  latestDeployment?: {
    targetServerName: string | null;
    imageTag: string | null;
  } | null;
}

export interface ProjectDetailEnvironment {
  id: string;
  name: string;
  slug: string;
  status: string;
  statusTone?: string;
  targetServerId?: string | null;
  composeFiles?: string[];
  composeProfiles?: string[];
  serviceCount?: number;
  createdAt: string;
}

export interface ProjectDetailServer {
  id: string;
  name: string;
  host?: string | null;
}

export interface ProjectDetailDeployment {
  serviceName: string;
  createdAt: string;
  status: string;
  statusTone?: string;
  statusLabel?: string;
}

export interface ProjectDetailSettingsDraft {
  name: string;
  description: string;
}
