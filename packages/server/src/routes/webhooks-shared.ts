import { createHmac, timingSafeEqual } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/connection";
import { auditEntries, events } from "../db/schema/audit";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { services } from "../db/schema/services";
import { triggerDeploy } from "../db/services/trigger-deploy";
import {
  matchWebhookWatchedPaths,
  normalizeWebhookChangedPaths,
  readWebhookAutoDeployConfig
} from "../webhook-auto-deploy";
import type {
  WebhookDeliveryProviderType,
  WebhookDeliveryStatus
} from "../db/services/webhook-deliveries";

export interface WebhookCommitChangeSet {
  added?: string[];
  modified?: string[];
  removed?: string[];
}

export interface GitHubPushEvent {
  ref?: string;
  after?: string;
  repository?: { full_name?: string };
  sender?: { login?: string };
  installation?: { id?: number };
  commits?: WebhookCommitChangeSet[];
}

export interface GitLabPushEvent {
  ref?: string;
  after?: string;
  checkout_sha?: string;
  event_name?: string;
  project?: { path_with_namespace?: string; id?: number };
  user_name?: string;
  commits?: WebhookCommitChangeSet[];
}

export interface WebhookDeployFailure {
  projectId: string;
  projectName: string;
  serviceId: string;
  status: string;
  entity?: string;
  message?: string;
}

export interface WebhookIgnoredTarget {
  projectId: string;
  projectName: string;
  reason: "branch_mismatch" | "path_filter" | "no_compose_services";
  branch?: string;
  targetBranch?: string;
  watchedPaths?: string[];
  changedPaths?: string[];
  matchedPaths?: string[];
}

export type WebhookTarget = {
  project: typeof projects.$inferSelect;
  provider: typeof gitProviders.$inferSelect;
  installation: typeof gitInstallations.$inferSelect | null;
};

export function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
  try {
    const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function verifyGitLabToken(token: string, expected: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

export function buildTargetResource(
  providerType: WebhookDeliveryProviderType,
  repoFullName: string
): string {
  return `webhook/${providerType}/${repoFullName}`;
}

export function collectChangedPaths(commits: WebhookCommitChangeSet[] | undefined): string[] {
  const changedPaths: string[] = [];

  for (const commit of commits ?? []) {
    changedPaths.push(
      ...(commit.added ?? []),
      ...(commit.modified ?? []),
      ...(commit.removed ?? [])
    );
  }

  return normalizeWebhookChangedPaths(changedPaths);
}

export function determineWebhookDeliveryStatus(input: {
  deploymentCount: number;
  failedTargetCount: number;
}): WebhookDeliveryStatus {
  if (input.failedTargetCount > 0 && input.deploymentCount > 0) {
    return "partial";
  }

  if (input.failedTargetCount > 0) {
    return "failed";
  }

  if (input.deploymentCount > 0) {
    return "queued";
  }

  return "ignored";
}

export async function writeWebhookAuditEntry(input: {
  providerType: WebhookDeliveryProviderType;
  repoFullName: string;
  actorId: string;
  actorEmail: string;
  action: string;
  inputSummary: string;
  outcome: "success" | "denied" | "failure";
  metadata: Record<string, unknown>;
}) {
  await db.insert(auditEntries).values({
    actorType: "system",
    actorId: input.actorId,
    actorEmail: input.actorEmail,
    actorRole: "agent",
    targetResource: buildTargetResource(input.providerType, input.repoFullName),
    action: input.action,
    inputSummary: input.inputSummary,
    permissionScope: "deploy:start",
    outcome: input.outcome,
    metadata: input.metadata
  });
}

export async function writeWebhookProjectEvent(input: {
  projectId: string;
  kind: "webhook.delivery.queued" | "webhook.delivery.ignored" | "webhook.delivery.failed";
  summary: string;
  detail?: string;
  severity: "info" | "warning" | "error";
  metadata: Record<string, unknown>;
}) {
  await db.insert(events).values({
    kind: input.kind,
    resourceType: "project",
    resourceId: input.projectId,
    summary: input.summary,
    detail: input.detail,
    severity: input.severity,
    metadata: input.metadata
  });
}

export async function listWebhookTargets(input: {
  repoFullName: string;
  providerType: WebhookDeliveryProviderType;
  externalInstallationId?: string | null;
}): Promise<WebhookTarget[]> {
  const matchingProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.repoFullName, input.repoFullName), eq(projects.autoDeploy, true)));

  const providerIds = [
    ...new Set(
      matchingProjects
        .map((project) => project.gitProviderId)
        .filter((providerId): providerId is string => Boolean(providerId))
    )
  ];
  const installationIds = [
    ...new Set(
      matchingProjects
        .map((project) => project.gitInstallationId)
        .filter((installationId): installationId is string => Boolean(installationId))
    )
  ];

  if (providerIds.length === 0) {
    return [];
  }

  const [providerRows, installationRows] = await Promise.all([
    db.select().from(gitProviders).where(inArray(gitProviders.id, providerIds)),
    installationIds.length > 0
      ? db.select().from(gitInstallations).where(inArray(gitInstallations.id, installationIds))
      : Promise.resolve([])
  ]);

  const providerById = new Map(providerRows.map((provider) => [provider.id, provider]));
  const installationById = new Map(
    installationRows.map((installation) => [installation.id, installation])
  );

  return matchingProjects.flatMap((project) => {
    if (!project.gitProviderId) {
      return [];
    }

    const provider = providerById.get(project.gitProviderId);
    if (!provider || provider.type !== input.providerType) {
      return [];
    }

    const installation = project.gitInstallationId
      ? (installationById.get(project.gitInstallationId) ?? null)
      : null;

    if (
      input.externalInstallationId &&
      installation?.installationId !== input.externalInstallationId
    ) {
      return [];
    }

    return [{ project, provider, installation }];
  });
}

export async function triggerWebhookDeploys(input: {
  projectId: string;
  projectName: string;
  commitSha: string;
  requestedByEmail: string;
}) {
  const matchingServices = await db
    .select({ id: services.id })
    .from(services)
    .where(and(eq(services.projectId, input.projectId), eq(services.sourceType, "compose")));

  const queuedDeployments = [];
  const failures: WebhookDeployFailure[] = [];
  for (const service of matchingServices) {
    const result = await triggerDeploy({
      serviceId: service.id,
      commitSha: input.commitSha,
      requestedByUserId: null,
      requestedByEmail: input.requestedByEmail,
      requestedByRole: "agent",
      trigger: "webhook"
    });

    if (result.status === "ok" && result.deployment) {
      queuedDeployments.push(result.deployment);
      continue;
    }

    failures.push({
      projectId: input.projectId,
      projectName: input.projectName,
      serviceId: service.id,
      status: result.status,
      entity: result.status === "not_found" ? result.entity : undefined,
      message:
        result.status === "invalid_source" || result.status === "provider_unavailable"
          ? result.message
          : undefined
    });
  }

  return {
    deployments: queuedDeployments,
    failures,
    matchedServiceCount: matchingServices.length
  };
}

export async function processWebhookPushTargets(input: {
  providerType: WebhookDeliveryProviderType;
  repoFullName: string;
  branch: string;
  commitSha: string;
  changedPaths: string[];
  requestedByEmail: string;
  matchingTargets: WebhookTarget[];
  deliveryKey: string;
}) {
  const deployments = [];
  const failedTargets: WebhookDeployFailure[] = [];
  const ignoredTargets: WebhookIgnoredTarget[] = [];

  for (const { project } of input.matchingTargets) {
    const targetBranch = project.autoDeployBranch || project.defaultBranch || "main";
    if (input.branch !== targetBranch) {
      const ignoredTarget: WebhookIgnoredTarget = {
        projectId: project.id,
        projectName: project.name,
        reason: "branch_mismatch",
        branch: input.branch,
        targetBranch
      };
      ignoredTargets.push(ignoredTarget);
      await writeWebhookProjectEvent({
        projectId: project.id,
        kind: "webhook.delivery.ignored",
        summary: `Ignored ${input.providerType} webhook for ${project.name}`,
        detail: `Branch ${input.branch} did not match auto-deploy branch ${targetBranch}.`,
        severity: "warning",
        metadata: {
          providerType: input.providerType,
          repoFullName: input.repoFullName,
          branch: input.branch,
          targetBranch,
          reason: ignoredTarget.reason,
          deliveryKey: input.deliveryKey
        }
      });
      continue;
    }

    const webhookConfig = readWebhookAutoDeployConfig(project.config);
    const pathMatch = matchWebhookWatchedPaths({
      watchedPaths: webhookConfig.watchedPaths,
      changedPaths: input.changedPaths
    });

    if (!pathMatch.matched) {
      const ignoredTarget: WebhookIgnoredTarget = {
        projectId: project.id,
        projectName: project.name,
        reason: "path_filter",
        branch: input.branch,
        targetBranch,
        watchedPaths: pathMatch.watchedPaths,
        changedPaths: input.changedPaths,
        matchedPaths: pathMatch.matchedPaths
      };
      ignoredTargets.push(ignoredTarget);
      await writeWebhookProjectEvent({
        projectId: project.id,
        kind: "webhook.delivery.ignored",
        summary: `Ignored ${input.providerType} webhook for ${project.name}`,
        detail: "No changed paths matched the configured auto-deploy path filters.",
        severity: "warning",
        metadata: {
          providerType: input.providerType,
          repoFullName: input.repoFullName,
          branch: input.branch,
          watchedPaths: pathMatch.watchedPaths,
          changedPaths: input.changedPaths,
          reason: ignoredTarget.reason,
          deliveryKey: input.deliveryKey
        }
      });
      continue;
    }

    const projectResult = await triggerWebhookDeploys({
      projectId: project.id,
      projectName: project.name,
      commitSha: input.commitSha,
      requestedByEmail: input.requestedByEmail
    });

    if (projectResult.matchedServiceCount === 0) {
      const ignoredTarget: WebhookIgnoredTarget = {
        projectId: project.id,
        projectName: project.name,
        reason: "no_compose_services",
        branch: input.branch,
        targetBranch
      };
      ignoredTargets.push(ignoredTarget);
      await writeWebhookProjectEvent({
        projectId: project.id,
        kind: "webhook.delivery.ignored",
        summary: `Ignored ${input.providerType} webhook for ${project.name}`,
        detail: "No compose-backed services are configured for webhook redeploys in this project.",
        severity: "warning",
        metadata: {
          providerType: input.providerType,
          repoFullName: input.repoFullName,
          branch: input.branch,
          reason: ignoredTarget.reason,
          deliveryKey: input.deliveryKey
        }
      });
      continue;
    }

    deployments.push(...projectResult.deployments);
    failedTargets.push(...projectResult.failures);

    if (projectResult.deployments.length > 0) {
      await writeWebhookProjectEvent({
        projectId: project.id,
        kind: "webhook.delivery.queued",
        summary: `Queued ${projectResult.deployments.length} webhook deployment${projectResult.deployments.length === 1 ? "" : "s"} for ${project.name}`,
        detail: `Accepted ${input.providerType} push for ${input.branch}@${input.commitSha.slice(0, 7)}.`,
        severity: "info",
        metadata: {
          providerType: input.providerType,
          repoFullName: input.repoFullName,
          branch: input.branch,
          commitSha: input.commitSha,
          deliveryKey: input.deliveryKey,
          deploymentIds: projectResult.deployments.map((deployment) => deployment.id)
        }
      });
    }

    if (projectResult.failures.length > 0) {
      await writeWebhookProjectEvent({
        projectId: project.id,
        kind: "webhook.delivery.failed",
        summary: `Webhook redeploy failed for ${project.name}`,
        detail: `One or more compose services could not be queued from ${input.providerType} push ${input.commitSha.slice(0, 7)}.`,
        severity: "error",
        metadata: {
          providerType: input.providerType,
          repoFullName: input.repoFullName,
          branch: input.branch,
          commitSha: input.commitSha,
          deliveryKey: input.deliveryKey,
          failures: projectResult.failures
        }
      });
    }
  }

  return {
    deployments,
    failedTargets,
    ignoredTargets
  };
}
