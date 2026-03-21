import { getInventoryTone } from "@/lib/tone-utils";
import type {
  ProjectDetailDeployment,
  ProjectDetailEnvironment,
  ProjectDetailService
} from "./project-detail-types";

export function getProjectConfig(config: unknown): Record<string, unknown> {
  return config && typeof config === "object" ? (config as Record<string, unknown>) : {};
}

export function getProjectDescription(config: Record<string, unknown>): string {
  return typeof config.description === "string" ? config.description : "";
}

export function getFilteredServices(
  services: ProjectDetailService[],
  activeEnvironmentId: string | null
): ProjectDetailService[] {
  if (!activeEnvironmentId) {
    return services;
  }

  return services.filter((service) => service.environmentId === activeEnvironmentId);
}

export function countServiceHealth(services: ProjectDetailService[]) {
  return services.reduce(
    (summary, service) => {
      const tone =
        service.runtimeSummary?.statusTone ??
        service.statusTone ??
        getInventoryTone(service.status);

      if (tone === "healthy" || tone === "running") {
        summary.healthy += 1;
      }

      if (tone === "failed") {
        summary.unhealthy += 1;
      }

      return summary;
    },
    { healthy: 0, unhealthy: 0 }
  );
}

export function getActiveEnvironmentName(
  environments: ProjectDetailEnvironment[],
  activeEnvironmentId: string | null
): string | undefined {
  return environments.find((environment) => environment.id === activeEnvironmentId)?.name;
}

export function getLastProjectDeployment(
  deployments: ProjectDetailDeployment[],
  services: ProjectDetailService[]
) {
  const projectDeployments = deployments.filter((deployment) =>
    services.some((service) => service.name === deployment.serviceName)
  );

  return projectDeployments[0];
}
