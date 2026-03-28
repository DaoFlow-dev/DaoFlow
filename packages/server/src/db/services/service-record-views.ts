import { desc, eq, inArray } from "drizzle-orm";
import { writeComposeReadinessProbeToConfig } from "../../compose-readiness";
import { writeComposePreviewConfigToConfig } from "../../compose-preview";
import {
  readServiceRuntimeConfigFromConfig,
  renderServiceRuntimeOverrideComposePreview,
  writeServiceRuntimeConfigToConfig
} from "../../service-runtime-config";
import {
  readServiceDomainConfigFromConfig,
  writeServiceDomainConfigToConfig
} from "../../service-domain-config";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { servers } from "../schema/servers";
import { services } from "../schema/services";
import { tunnelRoutes, tunnels } from "../schema/tunnels";
import {
  summarizeDeploymentHealth,
  summarizeRolloutStrategy,
  summarizeServiceRuntime
} from "./deployment-read-model";
import { readString } from "./json-helpers";
import {
  buildServiceEndpointSummary,
  type ServiceEndpointRouteObservation
} from "./service-endpoint-summary";

function buildServiceDeploymentKey(input: {
  projectId: string;
  environmentId: string;
  name: string;
  sourceType: string;
}) {
  return `${input.projectId}:${input.environmentId}:${input.name}:${input.sourceType}`;
}

export interface ServiceReadIndex {
  projectById: Map<string, typeof projects.$inferSelect>;
  environmentById: Map<string, typeof environments.$inferSelect>;
  serverById: Map<string, typeof servers.$inferSelect>;
  latestDeploymentByKey: Map<string, typeof deployments.$inferSelect>;
  routeByHostname: Map<string, ServiceEndpointRouteObservation>;
}

export function normalizeServiceRecord(service: typeof services.$inferSelect) {
  const config = writeServiceDomainConfigToConfig({
    config: writeServiceRuntimeConfigToConfig({
      config: writeComposePreviewConfigToConfig({
        config: writeComposeReadinessProbeToConfig({
          config: service.config
        })
      })
    })
  });

  return {
    ...service,
    config,
    domainConfig: readServiceDomainConfigFromConfig(config),
    runtimeConfig: readServiceRuntimeConfigFromConfig(config),
    runtimeConfigPreview: renderServiceRuntimeOverrideComposePreview({
      composeServiceName: service.composeServiceName,
      runtimeConfig: readServiceRuntimeConfigFromConfig(config)
    })
  };
}

export async function buildServiceReadIndex(
  serviceRows: (typeof services.$inferSelect)[]
): Promise<ServiceReadIndex> {
  if (serviceRows.length === 0) {
    return {
      projectById: new Map<string, typeof projects.$inferSelect>(),
      environmentById: new Map<string, typeof environments.$inferSelect>(),
      serverById: new Map<string, typeof servers.$inferSelect>(),
      latestDeploymentByKey: new Map<string, typeof deployments.$inferSelect>(),
      routeByHostname: new Map<string, ServiceEndpointRouteObservation>()
    };
  }

  const projectIds = [...new Set(serviceRows.map((row) => row.projectId))];
  const environmentIds = [...new Set(serviceRows.map((row) => row.environmentId))];

  const [projectRows, environmentRows, deploymentRows] = await Promise.all([
    db.select().from(projects).where(inArray(projects.id, projectIds)),
    db.select().from(environments).where(inArray(environments.id, environmentIds)),
    db
      .selectDistinctOn([
        deployments.projectId,
        deployments.environmentId,
        deployments.serviceName,
        deployments.sourceType
      ])
      .from(deployments)
      .where(inArray(deployments.environmentId, environmentIds))
      .orderBy(
        deployments.projectId,
        deployments.environmentId,
        deployments.serviceName,
        deployments.sourceType,
        desc(deployments.createdAt)
      )
  ]);
  const serverIds = [
    ...new Set(
      [
        ...serviceRows.map((row) => row.targetServerId),
        ...deploymentRows.map((row) => row.targetServerId)
      ].filter((value): value is string => typeof value === "string" && value.length > 0)
    )
  ];
  const desiredHostnames = [
    ...new Set(
      serviceRows.flatMap(
        (row) =>
          readServiceDomainConfigFromConfig(row.config)?.domains.map((domain) => domain.hostname) ??
          []
      )
    )
  ];
  const [serverRows, routeRows] = await Promise.all([
    serverIds.length > 0
      ? db.select().from(servers).where(inArray(servers.id, serverIds))
      : Promise.resolve([]),
    desiredHostnames.length > 0
      ? db
          .select({
            hostname: tunnelRoutes.hostname,
            service: tunnelRoutes.service,
            path: tunnelRoutes.path,
            status: tunnelRoutes.status,
            tunnelName: tunnels.name
          })
          .from(tunnelRoutes)
          .innerJoin(tunnels, eq(tunnels.id, tunnelRoutes.tunnelId))
          .where(inArray(tunnelRoutes.hostname, desiredHostnames))
      : Promise.resolve([])
  ]);

  const latestDeploymentByKey = new Map<string, typeof deployments.$inferSelect>();
  for (const deployment of deploymentRows) {
    const key = buildServiceDeploymentKey({
      projectId: deployment.projectId,
      environmentId: deployment.environmentId,
      name: deployment.serviceName,
      sourceType: deployment.sourceType
    });

    if (!latestDeploymentByKey.has(key)) {
      latestDeploymentByKey.set(key, deployment);
    }
  }

  return {
    projectById: new Map(projectRows.map((row) => [row.id, row])),
    environmentById: new Map(environmentRows.map((row) => [row.id, row])),
    serverById: new Map(serverRows.map((row) => [row.id, row])),
    latestDeploymentByKey,
    routeByHostname: new Map(routeRows.map((row) => [row.hostname, row]))
  };
}

export function buildServiceReadModel(
  service: typeof services.$inferSelect,
  index: ServiceReadIndex
) {
  const normalized = normalizeServiceRecord(service);
  const project = index.projectById.get(service.projectId);
  const environment = index.environmentById.get(service.environmentId);
  const latestDeployment =
    index.latestDeploymentByKey.get(
      buildServiceDeploymentKey({
        projectId: service.projectId,
        environmentId: service.environmentId,
        name: service.name,
        sourceType: service.sourceType
      })
    ) ?? null;
  const healthSummary = latestDeployment
    ? summarizeDeploymentHealth({ deployment: latestDeployment, steps: [] })
    : null;
  const targetServerName =
    latestDeployment && typeof latestDeployment.configSnapshot === "object"
      ? ((latestDeployment.configSnapshot as Record<string, unknown>).targetServerName as
          | string
          | undefined)
      : null;
  const runtimeSummary = summarizeServiceRuntime({
    latestDeployment,
    healthSummary,
    targetServerName
  });
  const targetServerId = latestDeployment?.targetServerId ?? service.targetServerId;
  const targetServer = targetServerId ? index.serverById.get(targetServerId) : undefined;
  const targetServerHost =
    (latestDeployment && typeof latestDeployment.configSnapshot === "object"
      ? readString(latestDeployment.configSnapshot as Record<string, unknown>, "targetServerHost")
      : null) ??
    targetServer?.host ??
    null;
  const rolloutStrategy = summarizeRolloutStrategy({
    sourceType: service.sourceType,
    serviceConfig: normalized.config,
    healthcheckPath: service.healthcheckPath
  });
  const endpointSummary = buildServiceEndpointSummary({
    serviceName: service.name,
    domainConfig: normalized.domainConfig,
    observedRoutesByHostname: index.routeByHostname,
    runtimeTone: runtimeSummary.statusTone,
    servicePort: service.port,
    healthcheckPath: service.healthcheckPath,
    targetServerHost,
    targetServerName
  });

  return {
    ...normalized,
    projectName: project?.name ?? null,
    environmentName: environment?.name ?? null,
    statusTone: runtimeSummary.statusTone,
    statusLabel: runtimeSummary.statusLabel,
    runtimeSummary,
    rolloutStrategy,
    endpointSummary,
    latestDeployment: latestDeployment
      ? {
          id: latestDeployment.id,
          status: healthSummary?.status ?? "not-configured",
          statusLabel: healthSummary?.statusLabel ?? runtimeSummary.statusLabel,
          statusTone: healthSummary?.statusTone ?? runtimeSummary.statusTone,
          summary: healthSummary?.summary ?? runtimeSummary.summary,
          failureAnalysis: healthSummary?.failureAnalysis ?? null,
          commitSha: latestDeployment.commitSha,
          imageTag: latestDeployment.imageTag,
          targetServerId: latestDeployment.targetServerId,
          targetServerName,
          targetServerHost,
          createdAt: latestDeployment.createdAt.toISOString(),
          finishedAt: latestDeployment.concludedAt?.toISOString() ?? null
        }
      : null
  };
}
