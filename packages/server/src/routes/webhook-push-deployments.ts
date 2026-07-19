import { triggerDeploy } from "../db/services/trigger-deploy";
import { webhookServiceTargetKey } from "./webhook-target-keys";
import { listComposeWebhookServiceIds } from "./webhook-push-target-discovery";
import type { WebhookTargetCallbacks } from "./webhook-push-target-callbacks";
import type { WebhookDeployFailure } from "./webhooks-types";

export async function triggerWebhookDeploys(
  input: {
    projectId: string;
    projectName: string;
    commitSha: string;
    requestedByEmail: string;
  } & WebhookTargetCallbacks
) {
  const matchingServices = await listComposeWebhookServiceIds(input.projectId);
  const queuedDeployments = [];
  const failures: WebhookDeployFailure[] = [];

  for (const service of matchingServices) {
    const targetKey = webhookServiceTargetKey(service.id);
    if (input.shouldProcessTarget && !input.shouldProcessTarget(targetKey)) continue;

    await input.onTargetStarted?.({
      targetKey,
      projectId: input.projectId,
      projectName: input.projectName,
      serviceId: service.id
    });

    const recoveredDeployment = await input.findRecoveredDeployment?.(targetKey);
    if (recoveredDeployment) {
      queuedDeployments.push(recoveredDeployment);
      await input.onTargetOutcome?.({
        targetKey,
        status: "queued",
        projectId: input.projectId,
        projectName: input.projectName,
        serviceId: service.id,
        deploymentId: recoveredDeployment.id
      });
      continue;
    }

    const result = await triggerDeploy({
      serviceId: service.id,
      commitSha: input.commitSha,
      requestedByUserId: null,
      requestedByEmail: input.requestedByEmail,
      requestedByRole: "agent",
      webhookDelivery: input.webhookDeliveryId
        ? { deliveryId: input.webhookDeliveryId, targetKey }
        : undefined,
      trigger: "webhook"
    });

    if (result.status === "ok" && result.deployment) {
      queuedDeployments.push(result.deployment);
      await input.onTargetOutcome?.({
        targetKey,
        status: "queued",
        projectId: input.projectId,
        projectName: input.projectName,
        serviceId: service.id,
        deploymentId: result.deployment.id
      });
      continue;
    }

    const failure: WebhookDeployFailure = {
      projectId: input.projectId,
      projectName: input.projectName,
      serviceId: service.id,
      status: result.status,
      entity: result.status === "not_found" ? result.entity : undefined,
      message:
        result.status === "invalid_source" || result.status === "provider_unavailable"
          ? result.message
          : undefined
    };
    failures.push(failure);
    await input.onTargetOutcome?.({
      targetKey,
      status: "failed",
      projectId: input.projectId,
      projectName: input.projectName,
      serviceId: service.id,
      failureStatus: failure.status,
      entity: failure.entity,
      message: failure.message
    });
  }

  return { deployments: queuedDeployments, failures, matchedServiceCount: matchingServices.length };
}
