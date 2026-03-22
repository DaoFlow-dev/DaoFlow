import type { AppTemplateDefinition } from "@daoflow/shared";

export type TemplateFieldValues = Record<string, string>;

export interface TemplateServerOption {
  id: string;
  name: string;
  host: string;
  targetKind: string;
}

export interface TemplateDeployResult {
  deploymentId: string;
  projectName: string;
  projectId: string;
  environmentId: string;
  serviceId: string;
}

export interface TemplatePreviewPlanData {
  project: {
    name: string;
    action: string;
  };
  environment: {
    name: string;
    action: string;
  };
  service: {
    name: string;
    action: string;
  };
  target: {
    serverName: string;
    serverHost: string;
    targetKind: string | null;
  };
  preflightChecks: Array<{
    status: string;
    detail: string;
  }>;
  steps: string[];
  executeCommand: string;
}

export interface TemplatePreviewState {
  data: TemplatePreviewPlanData | null | undefined;
  isLoading: boolean;
  error: {
    message: string;
  } | null;
}

export interface TemplateCatalogCardProps {
  matchingTemplates: AppTemplateDefinition[];
  activeSlug: string;
  onSelectTemplate: (slug: string) => void;
}
