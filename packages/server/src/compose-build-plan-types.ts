export type ComposeBuildContextType = "local-path" | "remote-url" | "docker-image" | "service";

export interface ComposeBuildPlanArg {
  key: string;
  source: "literal" | "interpolated" | "implicit";
}

export interface ComposeBuildPlanAdditionalContext {
  name: string;
  value: string;
  type: ComposeBuildContextType;
}

export interface ComposeBuildPlanSecret {
  sourceName: string;
  provider: "file" | "environment" | "external" | "unknown";
  reference: string | null;
  target: string | null;
}

export interface ComposeBuildPlanConfig {
  sourceName: string;
  provider: "file" | "environment" | "content" | "external" | "unknown";
  reference: string | null;
  target: string | null;
}

export interface ComposeBuildPlanDependency {
  serviceName: string;
  condition: "service_started" | "service_healthy" | "service_completed_successfully";
  required: boolean;
  restart: boolean;
}

export interface ComposeBuildPlanHealthcheck {
  present: boolean;
  disabled: boolean;
  testType: "none" | "command" | "unknown";
  interval: string | null;
  timeout: string | null;
  startPeriod: string | null;
  startInterval: string | null;
  retries: number | null;
}

export interface ComposeBuildPlanService {
  serviceName: string;
  context: string;
  contextType: ComposeBuildContextType;
  image: string | null;
  dockerfile: string | null;
  target: string | null;
  args: ComposeBuildPlanArg[];
  additionalContexts: ComposeBuildPlanAdditionalContext[];
  secrets: ComposeBuildPlanSecret[];
}

export interface ComposeBuildPlanGraphService {
  serviceName: string;
  image: string | null;
  hasBuild: boolean;
  dependsOn: ComposeBuildPlanDependency[];
  healthcheck: ComposeBuildPlanHealthcheck;
  networks: string[];
  namedVolumes: string[];
  runtimeSecrets: ComposeBuildPlanSecret[];
  configs: ComposeBuildPlanConfig[];
  profiles: string[];
}

export interface ComposeBuildPlanNetwork {
  name: string;
  external: boolean;
  driver: string | null;
}

export interface ComposeBuildPlanVolume {
  name: string;
  external: boolean;
  driver: string | null;
}

export interface ComposeBuildPlanSecretDefinition {
  name: string;
  provider: "file" | "environment" | "external" | "unknown";
  reference: string | null;
  external: boolean;
}

export interface ComposeBuildPlanConfigDefinition {
  name: string;
  provider: "file" | "environment" | "content" | "external" | "unknown";
  reference: string | null;
  external: boolean;
}

export interface ComposeBuildPlan {
  status: "materialized";
  version: 1;
  stackName: string | null;
  strategy: "pull-only" | "build-only" | "mixed";
  services: ComposeBuildPlanService[];
  graphServices: ComposeBuildPlanGraphService[];
  networks: ComposeBuildPlanNetwork[];
  volumes: ComposeBuildPlanVolume[];
  secrets: ComposeBuildPlanSecretDefinition[];
  configs: ComposeBuildPlanConfigDefinition[];
  warnings: string[];
}
