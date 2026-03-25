export interface EnvironmentRecord {
  id: string;
  name: string;
  status: string;
  statusTone?: string;
  targetServerId?: string | null;
  composeFiles?: string[];
  composeProfiles?: string[];
  serviceCount?: number;
}

export interface ServerRecord {
  id: string;
  name: string;
  host?: string | null;
}

export interface EnvironmentDraft {
  id?: string;
  name: string;
  status: string;
  targetServerId: string;
  composeFiles: string;
  composeProfiles: string;
}

export interface ProjectEnvironmentsPanelProps {
  projectId: string;
  environments: EnvironmentRecord[];
  servers: ServerRecord[];
  activeEnvironmentId: string | null;
  createPending: boolean;
  updatePending: boolean;
  deletePending: boolean;
  errorMessage?: string | null;
  onActiveEnvironmentChange: (environmentId: string | null) => void;
  onOpenDeploy: (source: "template" | "compose", environment: EnvironmentRecord) => void;
  onCreate: (input: {
    projectId: string;
    name: string;
    targetServerId?: string;
    composeFiles?: string[];
    composeProfiles?: string[];
  }) => void;
  onUpdate: (input: {
    environmentId: string;
    name?: string;
    status?: string;
    targetServerId?: string;
    composeFiles?: string[];
    composeProfiles?: string[];
  }) => void;
  onDelete: (environmentId: string) => void;
}
