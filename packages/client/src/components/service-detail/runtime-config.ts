export type RuntimeVolumeMode = "rw" | "ro";
export type RuntimeRestartPolicyName = "always" | "unless-stopped" | "on-failure" | "no";

export interface ServiceRuntimeVolume {
  source: string;
  target: string;
  mode: RuntimeVolumeMode;
}

export interface ServiceRuntimeRestartPolicy {
  name: RuntimeRestartPolicyName;
  maxRetries: number | null;
}

export interface ServiceRuntimeHealthCheck {
  command: string;
  intervalSeconds: number;
  timeoutSeconds: number;
  retries: number;
  startPeriodSeconds: number;
}

export interface ServiceRuntimeResources {
  cpuLimitCores: number | null;
  cpuReservationCores: number | null;
  memoryLimitMb: number | null;
  memoryReservationMb: number | null;
}

export interface ServiceRuntimeConfig {
  volumes: ServiceRuntimeVolume[];
  networks: string[];
  restartPolicy: ServiceRuntimeRestartPolicy | null;
  healthCheck: ServiceRuntimeHealthCheck | null;
  resources: ServiceRuntimeResources | null;
}

export interface RuntimeConfigServiceSupport {
  sourceType: string;
  composeServiceName: string | null;
}

export function getRuntimeConfigSupportReason(service: RuntimeConfigServiceSupport): string | null {
  if (service.sourceType !== "compose") {
    return "DaoFlow-managed runtime overrides are only supported for compose services today.";
  }

  if (!service.composeServiceName) {
    return "This service is not bound to a concrete compose service name, so DaoFlow cannot render a safe service-level override yet.";
  }

  return null;
}
