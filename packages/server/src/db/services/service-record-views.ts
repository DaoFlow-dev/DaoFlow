import { desc, inArray } from "drizzle-orm";
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
import { services } from "../schema/services";
import {
  summarizeDeploymentHealth,
  summarizeRolloutStrategy,
  summarizeServiceRuntime
} from "./deployment-read-model";

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
  latestDeploymentByKey: Map<string, typeof deployments.$inferSelect>;
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
      latestDeploymentByKey: new Map<string, typeof deployments.$inferSelect>()
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
    latestDeploymentByKey
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
  const rolloutStrategy = summarizeRolloutStrategy({
    sourceType: service.sourceType,
    serviceConfig: normalized.config,
    healthcheckPath: service.healthcheckPath
  });

  return {
    ...normalized,
    projectName: project?.name ?? null,
    environmentName: environment?.name ?? null,
    statusTone: runtimeSummary.statusTone,
    statusLabel: runtimeSummary.statusLabel,
    runtimeSummary,
    rolloutStrategy,
    latestDeployment: latestDeployment
      ? {
          id: latestDeployment.id,
          status: healthSummary?.status ?? "not-configured",
          statusLabel: healthSummary?.statusLabel ?? runtimeSummary.statusLabel,
          statusTone: healthSummary?.statusTone ?? runtimeSummary.statusTone,
          summary: healthSummary?.summary ?? runtimeSummary.summary,
          commitSha: latestDeployment.commitSha,
          imageTag: latestDeployment.imageTag,
          targetServerId: latestDeployment.targetServerId,
          targetServerName,
          createdAt: latestDeployment.createdAt.toISOString(),
          finishedAt: latestDeployment.concludedAt?.toISOString() ?? null
        }
      : null
  };
}
