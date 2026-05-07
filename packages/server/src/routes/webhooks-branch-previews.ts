import { deriveComposePreviewKey, normalizeComposePreviewRequest } from "../compose-preview";
import {
  findLatestPreviewDeploymentForService,
  listEligiblePreviewWebhookServices,
  recordPreviewWebhookLifecycleEvent
} from "../db/services/webhook-deliveries";
import { triggerDeploy } from "../db/services/trigger-deploy";
import type { WebhookDeliveryProviderType } from "../db/services/webhook-deliveries";
import type { WebhookDeployFailure, WebhookTarget } from "./webhooks-types";
import {
  readPreviewFailureMessage,
  shouldDeduplicatePreviewRequest,
  summarizeCommit
} from "./webhooks-preview-helpers";

export async function triggerBranchPreviewWebhookDeploys(input: {
  providerType: WebhookDeliveryProviderType;
  repoFullName: string;
  projectTarget: WebhookTarget;
  branch: string;
  action: "deploy" | "destroy";
  commitSha: string;
  requestedByEmail: string;
  deliveryKey: string;
}) {
  const { project } = input.projectTarget;
  const previewRequest = normalizeComposePreviewRequest({
    target: "branch",
    branch: input.branch,
    action: input.action
  });
  const previewKey = deriveComposePreviewKey(previewRequest);
  const eligibleServices = await listEligiblePreviewWebhookServices({
    projectId: project.id,
    previewRequest
  });

  if (eligibleServices.length === 0) {
    return { handled: false, deployments: [], failures: [] as WebhookDeployFailure[] };
  }

  const deployments = [];
  const failures: WebhookDeployFailure[] = [];

  for (const service of eligibleServices) {
    const latestDeployment = await findLatestPreviewDeploymentForService({
      projectId: service.projectId,
      environmentId: service.environmentId,
      serviceName: service.name,
      previewKey
    });

    if (
      shouldDeduplicatePreviewRequest({
        latestDeployment,
        commitSha: input.commitSha,
        requestedAction: input.action
      })
    ) {
      await recordPreviewWebhookLifecycleEvent({
        providerType: input.providerType,
        repoFullName: input.repoFullName,
        projectId: project.id,
        serviceId: service.id,
        actorEmail: input.requestedByEmail,
        previewKey,
        previewAction: input.action,
        eventAction: input.action === "destroy" ? "branch_deleted" : "branch_push",
        outcome: "deduped",
        summary: `Skipped duplicate branch preview ${input.action} for ${service.name}.`,
        detail: `The latest deployment already represents ${previewKey} ${input.action}${input.action === "deploy" ? ` at ${summarizeCommit(input.commitSha)}` : ""}.`,
        commitSha: input.commitSha,
        deploymentId: latestDeployment?.id,
        metadata: {
          deliveryKey: input.deliveryKey,
          source: "branch-preview-dedupe"
        }
      });
      continue;
    }

    const result = await triggerDeploy({
      serviceId: service.id,
      commitSha: input.commitSha || undefined,
      preview: {
        target: previewRequest.target,
        branch: previewRequest.branch,
        action: previewRequest.action
      },
      previewProviderType: input.providerType,
      requestedByUserId: null,
      requestedByEmail: input.requestedByEmail,
      requestedByRole: "agent",
      trigger: "webhook"
    });

    if (result.status === "ok" && result.deployment) {
      deployments.push(result.deployment);
      await recordPreviewWebhookLifecycleEvent({
        providerType: input.providerType,
        repoFullName: input.repoFullName,
        projectId: project.id,
        serviceId: service.id,
        actorEmail: input.requestedByEmail,
        previewKey,
        previewAction: input.action,
        eventAction: input.action === "destroy" ? "branch_deleted" : "branch_push",
        outcome: "queued",
        summary: `Queued branch preview ${input.action} for ${service.name}.`,
        detail: `DaoFlow queued ${previewKey} ${input.action} from ${input.providerType} push.`,
        commitSha: input.commitSha,
        deploymentId: result.deployment.id,
        metadata: {
          deliveryKey: input.deliveryKey
        }
      });
      continue;
    }

    failures.push({
      projectId: project.id,
      projectName: project.name,
      serviceId: service.id,
      status: result.status,
      entity: result.status === "not_found" ? result.entity : undefined,
      message: readPreviewFailureMessage(result)
    });
  }

  return { handled: true, deployments, failures };
}
