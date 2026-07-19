import type { WebhookDeliveryProviderType } from "../db/services/webhook-deliveries";
import { matchWebhookWatchedPaths, readWebhookAutoDeployConfig } from "../webhook-auto-deploy";
import { triggerBranchPreviewWebhookDeploys } from "./webhooks-branch-previews";
import { writeWebhookProjectEvent } from "./webhooks-delivery";
import { triggerWebhookDeploys } from "./webhook-push-deployments";
import type { WebhookTargetCallbacks } from "./webhook-push-target-callbacks";
import { webhookProjectTargetKey } from "./webhook-target-keys";
import type { WebhookDeployFailure, WebhookIgnoredTarget, WebhookTarget } from "./webhooks-types";

export async function processWebhookPushTargets(
  input: {
    providerType: WebhookDeliveryProviderType;
    repoFullName: string;
    branch: string;
    commitSha: string;
    changedPaths: string[];
    deleted?: boolean;
    requestedByEmail: string;
    matchingTargets: WebhookTarget[];
    deliveryKey: string;
  } & WebhookTargetCallbacks
) {
  const deployments = [];
  const failedTargets: WebhookDeployFailure[] = [];
  const ignoredTargets: WebhookIgnoredTarget[] = [];

  for (const { project, provider, installation } of input.matchingTargets) {
    const targetBranch = project.autoDeployBranch || project.defaultBranch || "main";
    if (input.branch !== targetBranch) {
      const previewResult = await triggerBranchPreviewWebhookDeploys({
        providerType: input.providerType,
        repoFullName: input.repoFullName,
        projectTarget: { project, provider, installation },
        branch: input.branch,
        action: input.deleted === true ? "destroy" : "deploy",
        commitSha: input.commitSha,
        requestedByEmail: input.requestedByEmail,
        deliveryKey: input.deliveryKey,
        shouldProcessTarget: input.shouldProcessTarget,
        onTargetStarted: input.onTargetStarted,
        onTargetOutcome: input.onTargetOutcome,
        webhookDeliveryId: input.webhookDeliveryId,
        findRecoveredDeployment: input.findRecoveredDeployment
      });

      if (previewResult.handled) {
        deployments.push(...previewResult.deployments);
        failedTargets.push(...previewResult.failures);
        continue;
      }

      const ignoredTarget: WebhookIgnoredTarget = {
        projectId: project.id,
        projectName: project.name,
        reason: "branch_mismatch",
        branch: input.branch,
        targetBranch
      };
      const targetKey = webhookProjectTargetKey(project.id);
      if (input.shouldProcessTarget && !input.shouldProcessTarget(targetKey)) {
        continue;
      }
      await input.onTargetStarted?.({
        targetKey,
        projectId: project.id,
        projectName: project.name
      });
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
      await input.onTargetOutcome?.({
        targetKey,
        status: "ignored",
        projectId: project.id,
        projectName: project.name,
        reason: ignoredTarget.reason
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
      const targetKey = webhookProjectTargetKey(project.id);
      if (input.shouldProcessTarget && !input.shouldProcessTarget(targetKey)) {
        continue;
      }
      await input.onTargetStarted?.({
        targetKey,
        projectId: project.id,
        projectName: project.name
      });
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
      await input.onTargetOutcome?.({
        targetKey,
        status: "ignored",
        projectId: project.id,
        projectName: project.name,
        reason: ignoredTarget.reason
      });
      continue;
    }

    const projectResult = await triggerWebhookDeploys({
      projectId: project.id,
      projectName: project.name,
      commitSha: input.commitSha,
      requestedByEmail: input.requestedByEmail,
      shouldProcessTarget: input.shouldProcessTarget,
      onTargetStarted: input.onTargetStarted,
      onTargetOutcome: input.onTargetOutcome,
      webhookDeliveryId: input.webhookDeliveryId,
      findRecoveredDeployment: input.findRecoveredDeployment
    });

    if (projectResult.matchedServiceCount === 0) {
      const ignoredTarget: WebhookIgnoredTarget = {
        projectId: project.id,
        projectName: project.name,
        reason: "no_compose_services",
        branch: input.branch,
        targetBranch
      };
      const targetKey = webhookProjectTargetKey(project.id);
      if (input.shouldProcessTarget && !input.shouldProcessTarget(targetKey)) {
        continue;
      }
      await input.onTargetStarted?.({
        targetKey,
        projectId: project.id,
        projectName: project.name
      });
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
      await input.onTargetOutcome?.({
        targetKey,
        status: "ignored",
        projectId: project.id,
        projectName: project.name,
        reason: ignoredTarget.reason
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
