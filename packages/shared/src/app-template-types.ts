export type AppTemplateCategory = "application" | "database" | "cache" | "queue";

export type AppTemplateFieldKind = "string" | "secret" | "domain" | "port";

export interface AppTemplateMaintenanceDefinition {
  version: string;
  sourceName: string;
  sourceUrl: string;
  reviewedAt: string;
  reviewCadenceDays: number;
  changeNotes: string[];
}

export interface AppTemplateFieldDefinition {
  key: string;
  label: string;
  kind: AppTemplateFieldKind;
  description: string;
  required?: boolean;
  defaultValue?: string;
  exampleValue?: string;
}

export interface AppTemplateServiceDefinition {
  name: string;
  role: "app" | "database" | "cache" | "queue";
  summary: string;
}

export interface AppTemplateVolumeDefinition {
  nameTemplate: string;
  mountPath: string;
  summary: string;
}

export interface AppTemplateHealthCheckDefinition {
  serviceName: string;
  summary: string;
  readinessHint: string;
}

export interface AppTemplateDefinition {
  slug: string;
  name: string;
  category: AppTemplateCategory;
  summary: string;
  description: string;
  tags: string[];
  defaultProjectName: string;
  services: AppTemplateServiceDefinition[];
  fields: AppTemplateFieldDefinition[];
  volumes: AppTemplateVolumeDefinition[];
  healthChecks: AppTemplateHealthCheckDefinition[];
  maintenance: AppTemplateMaintenanceDefinition;
  composeTemplate: string;
}

export interface RenderedTemplateField extends AppTemplateFieldDefinition {
  value: string;
}

export interface RenderedAppTemplate {
  template: AppTemplateDefinition;
  projectName: string;
  stackName: string;
  compose: string;
  fields: RenderedTemplateField[];
}
