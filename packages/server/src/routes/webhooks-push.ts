import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { services } from "../db/schema/services";
import type { WebhookDeliveryProviderType } from "../db/services/webhook-deliveries";
import { triggerDeploy } from "../db/services/trigger-deploy";
import { matchWebhookWatchedPaths, readWebhookAutoDeployConfig } from "../webhook-auto-deploy";
import { writeWebhookProjectEvent } from "./webhooks-delivery";
import type { WebhookDeployFailure, WebhookIgnoredTarget, WebhookTarget } from "./webhooks-types";

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
