import type { ComposeBuildPlan, ComposeBuildPlanGraphService } from "./compose-build-plan";

export interface ComposeExecutionScope {
  requestedServiceName: string | null;
  expectedServiceNames: string[];
  buildServiceNames: string[];
  buildHealthcheckServiceNames: string[];
  needsPull: boolean;
}

function resolveGraphServices(plan: ComposeBuildPlan): ComposeBuildPlanGraphService[] {
  if (Array.isArray(plan.graphServices) && plan.graphServices.length > 0) {
    return plan.graphServices;
  }

  return plan.services.map((service) => ({
    serviceName: service.serviceName,
    image: service.image,
    hasBuild: true,
    dependsOn: [],
    healthcheck: {
      present: false,
      disabled: false,
      testType: "none",
      interval: null,
      timeout: null,
      startPeriod: null,
      startInterval: null,
      retries: null
    },
    networks: [],
    namedVolumes: [],
    runtimeSecrets: [],
    configs: [],
    profiles: []
  }));
}

function resolveDependencyClosure(
  graphServices: ComposeBuildPlanGraphService[],
  requestedServiceName: string
): string[] {
  const servicesByName = new Map(graphServices.map((service) => [service.serviceName, service]));
  const visited = new Set<string>();
  const queue = [requestedServiceName];

  while (queue.length > 0) {
    const serviceName = queue.shift();
    if (!serviceName || visited.has(serviceName)) {
      continue;
    }

    visited.add(serviceName);
    const service = servicesByName.get(serviceName);
    for (const dependency of service?.dependsOn ?? []) {
      if (dependency.required !== false && !visited.has(dependency.serviceName)) {
        queue.push(dependency.serviceName);
      }
    }
  }

  return [...visited].sort((a, b) => a.localeCompare(b));
}

function isComposeProfileEnabled(
  service: ComposeBuildPlanGraphService,
  composeProfiles: string[]
): boolean {
  if (service.profiles.length === 0) {
    return true;
  }

  if (composeProfiles.length === 0) {
    return false;
  }

  return service.profiles.some((profile) => composeProfiles.includes(profile));
}

export function resolveComposeExecutionScope(
  plan: ComposeBuildPlan,
  composeServiceName?: string | null,
  composeProfiles: string[] = []
): ComposeExecutionScope {
  const graphServices = resolveGraphServices(plan);
  const scopedServiceName = composeServiceName?.trim() || null;
  const hasNormalizedGraph = Array.isArray(plan.graphServices) && plan.graphServices.length > 0;

  if (!hasNormalizedGraph) {
    const hasScopedBuildService = scopedServiceName
      ? plan.services.some((service) => service.serviceName === scopedServiceName)
      : plan.services.length > 0;

    return {
      requestedServiceName: scopedServiceName,
      expectedServiceNames: scopedServiceName
        ? [scopedServiceName]
        : plan.services.map((service) => service.serviceName).sort((a, b) => a.localeCompare(b)),
      buildServiceNames: scopedServiceName
        ? hasScopedBuildService
          ? [scopedServiceName]
          : []
        : plan.services.map((service) => service.serviceName).sort((a, b) => a.localeCompare(b)),
      buildHealthcheckServiceNames: [],
      needsPull: scopedServiceName
        ? plan.strategy === "mixed" || !hasScopedBuildService
        : plan.strategy !== "build-only"
    };
  }

  const activeGraphServices = graphServices.filter((service) =>
    isComposeProfileEnabled(service, composeProfiles)
  );
  const expectedServiceNames = scopedServiceName
    ? resolveDependencyClosure(graphServices, scopedServiceName)
    : activeGraphServices.map((service) => service.serviceName).sort((a, b) => a.localeCompare(b));
  const expectedServiceNameSet = new Set(expectedServiceNames);
  const buildServiceNames = graphServices
    .filter((service) => expectedServiceNameSet.has(service.serviceName) && service.hasBuild)
    .map((service) => service.serviceName)
    .sort((a, b) => a.localeCompare(b));
  const buildHealthcheckServiceNames = graphServices
    .filter(
      (service) =>
        expectedServiceNameSet.has(service.serviceName) &&
        service.healthcheck.present &&
        !service.healthcheck.disabled
    )
    .map((service) => service.serviceName)
    .sort((a, b) => a.localeCompare(b));
  const expectedServices = graphServices.filter((service) =>
    expectedServiceNameSet.has(service.serviceName)
  );
  const missingRequestedService = scopedServiceName !== null && expectedServices.length === 0;

  return {
    requestedServiceName: scopedServiceName,
    expectedServiceNames,
    buildServiceNames,
    buildHealthcheckServiceNames,
    needsPull: missingRequestedService || expectedServices.some((service) => !service.hasBuild)
  };
}
