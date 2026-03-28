import { and, desc, eq, sql } from "drizzle-orm";
import {
  formatDeploymentStatusLabel,
  getDeploymentStatusTone,
  normalizeDeploymentStatus
} from "@daoflow/shared";
import { db } from "../connection";
import { deployments } from "../schema/deployments";
import { services } from "../schema/services";
import { asRecord } from "./json-helpers";
import {
  readComposePreviewConfigFromConfig,
  readComposePreviewMetadata
} from "../../compose-preview";
import { resolveServiceForUser } from "./scoped-services";

type ComposePreviewHistoryService = {
  id: string;
  name: string;
  environmentId: string;
  projectId: string;
  config: unknown;
};

export interface ComposePreviewHistoryRecord {
  key: string;
  target: "branch" | "pull-request";
  branch: string;
  pullRequestNumber: number | null;
  envBranch: string;
  stackName: string;
  primaryDomain: string | null;
  latestDeploymentId: string;
  latestAction: "deploy" | "destroy";
  latestStatus: string;
  latestStatusLabel: string;
  latestStatusTone: "healthy" | "running" | "failed" | "queued";
  lastRequestedAt: string;
  lastFinishedAt: string | null;
  isActive: boolean;
  latestDeployment: typeof deployments.$inferSelect;
}

async function loadComposePreviewHistoryForService(service: ComposePreviewHistoryService) {
  const rows = await db
    .select()
    .from(deployments)
    .where(
      and(
        eq(deployments.projectId, service.projectId),
        eq(deployments.environmentId, service.environmentId),
        eq(deployments.serviceName, service.name),
        eq(deployments.sourceType, "compose"),
        sql`${deployments.configSnapshot} ? 'preview'`
      )
    )
    .orderBy(desc(deployments.createdAt));
  const previews = new Map<string, ComposePreviewHistoryRecord>();

  for (const row of rows) {
    const preview = readComposePreviewMetadata(asRecord(row.configSnapshot).preview);
    if (!preview || previews.has(preview.key)) {
      continue;
    }

    const lifecycleStatus = normalizeDeploymentStatus(row.status, row.conclusion);
    const isHealthyDeploy =
      preview.action === "deploy" && row.status === "completed" && row.conclusion === "succeeded";

    previews.set(preview.key, {
      key: preview.key,
      target: preview.target,
      branch: preview.branch,
      pullRequestNumber: preview.pullRequestNumber,
      envBranch: preview.envBranch,
      stackName: preview.stackName,
      primaryDomain: preview.primaryDomain,
      latestDeploymentId: row.id,
      latestAction: preview.action,
      latestStatus: lifecycleStatus,
      latestStatusLabel: formatDeploymentStatusLabel(row.status, row.conclusion),
      latestStatusTone: getDeploymentStatusTone(row.status, row.conclusion),
      lastRequestedAt: row.createdAt.toISOString(),
      lastFinishedAt: row.concludedAt?.toISOString() ?? null,
      isActive: isHealthyDeploy,
      latestDeployment: row
    });
  }

  return {
    service: {
      id: service.id,
      name: service.name,
      environmentId: service.environmentId,
      projectId: service.projectId,
      config: service.config,
      previewConfig: readComposePreviewConfigFromConfig(service.config)
    },
    previews: [...previews.values()]
  };
}

export async function loadComposePreviewHistory(input: {
  serviceRef: string;
  requestedByUserId: string;
}) {
  const service = await resolveServiceForUser(input.serviceRef, input.requestedByUserId);
  return loadComposePreviewHistoryForService(service);
}

export async function loadComposePreviewHistoryForServiceId(serviceId: string) {
  const [service] = await db.select().from(services).where(eq(services.id, serviceId)).limit(1);

  if (!service) {
    throw new Error("Service not found for compose preview history.");
  }

  return loadComposePreviewHistoryForService(service);
}

export async function listComposePreviewDeployments(input: {
  serviceRef: string;
  requestedByUserId: string;
}) {
  const history = await loadComposePreviewHistory(input);

  return {
    service: history.service,
    previews: history.previews.map(({ latestDeployment: _latestDeployment, ...preview }) => preview)
  };
}
