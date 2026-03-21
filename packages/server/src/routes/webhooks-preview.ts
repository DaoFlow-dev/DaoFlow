import {
  beginWebhookDelivery,
  completeWebhookDelivery,
  findLatestPreviewDeploymentForService,
  listEligiblePreviewWebhookServices,
  recordPreviewWebhookLifecycleEvent
} from "../db/services/webhook-deliveries";
import { triggerDeploy } from "../db/services/trigger-deploy";
import type { WebhookTarget } from "./webhooks-types";
import {
  PreviewWebhookDeployFailure,
  readPreviewFailureMessage,
  resolvePreviewDeliveryOutcome,
  shouldDeduplicatePreviewRequest,
  summarizeCommit
} from "./webhooks-preview-helpers";

type ProviderType = "github" | "gitlab";

export async function triggerPreviewWebhookDeploys(input: {
  providerType: ProviderType;
  repoFullName: string;
  matchingTargets: WebhookTarget[];
  deliveryKey: string;
  eventType: string;
  eventAction: string;
  requestedByEmail: string;
  commitSha: string;
  preview: {
    target: "pull-request";
    branch: string;
    pullRequestNumber: number;
    action: "deploy" | "destroy";
  };
}) {
  const previewKey = `pr-${input.preview.pullRequestNumber}`;
  const started = await beginWebhookDelivery({
    providerType: input.providerType,
    deliveryKey: input.deliveryKey,
    eventType: input.eventType,
    repoFullName: input.repoFullName,
    previewKey,
    previewAction: input.preview.action,
    commitSha: input.commitSha,
    metadata: {
      eventAction: input.eventAction,
      projectIds: input.matchingTargets.map(({ project }) => project.id)
    }
  });

  if (started.status === "duplicate") {
    for (const { project } of input.matchingTargets) {
      await recordPreviewWebhookLifecycleEvent({
        providerType: input.providerType,
        repoFullName: input.repoFullName,
        projectId: project.id,
        actorEmail: input.requestedByEmail,
        previewKey,
        previewAction: input.preview.action,
        eventAction: input.eventAction,
        outcome: "deduped",
        summary: `Skipped duplicate preview ${input.preview.action} delivery for ${previewKey}.`,
        detail: `DaoFlow ignored a repeated ${input.providerType} ${input.eventType} delivery for ${previewKey}.`,
        commitSha: input.commitSha,
        metadata: {
          deliveryKey: input.deliveryKey,
          source: "transport-delivery-ledger"
        }
      });
    }

    return {
      ok: true,
      deduped: true,
      action: input.preview.action,
      previewKey,
      branch: input.preview.branch,
      commit: summarizeCommit(input.commitSha)
    };
  }

  let queued = 0;
  let deduped = 0;
  let ignored = 0;
  const failedTargets: PreviewWebhookDeployFailure[] = [];

  for (const { project } of input.matchingTargets) {
    const eligibleServices = await listEligiblePreviewWebhookServices({
      projectId: project.id,
      previewRequest: input.preview
    });

    if (eligibleServices.length === 0) {
      ignored += 1;
      await recordPreviewWebhookLifecycleEvent({
        providerType: input.providerType,
        repoFullName: input.repoFullName,
        projectId: project.id,
        actorEmail: input.requestedByEmail,
        previewKey,
        previewAction: input.preview.action,
        eventAction: input.eventAction,
        outcome: "ignored",
        summary: `Ignored preview ${input.preview.action} webhook for ${previewKey}.`,
        detail:
          "No preview-enabled compose service in this project accepts pull-request preview automation.",
        commitSha: input.commitSha,
        metadata: {
          deliveryKey: input.deliveryKey
        }
      });
      continue;
    }

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
          requestedAction: input.preview.action
        })
      ) {
        deduped += 1;
        await recordPreviewWebhookLifecycleEvent({
          providerType: input.providerType,
          repoFullName: input.repoFullName,
          projectId: project.id,
          serviceId: service.id,
          actorEmail: input.requestedByEmail,
          previewKey,
          previewAction: input.preview.action,
          eventAction: input.eventAction,
          outcome: "deduped",
          summary: `Skipped duplicate preview ${input.preview.action} for ${service.name}.`,
          detail: `The latest deployment already represents ${previewKey} ${input.preview.action}${input.preview.action === "deploy" ? ` at ${summarizeCommit(input.commitSha)}` : ""}.`,
          commitSha: input.commitSha,
          deploymentId: latestDeployment?.id,
          metadata: {
            deliveryKey: input.deliveryKey,
            source: "semantic-preview-dedupe"
          }
        });
        continue;
      }

      const result = await triggerDeploy({
        serviceId: service.id,
        commitSha: input.commitSha || undefined,
        preview: input.preview,
        requestedByUserId: null,
        requestedByEmail: input.requestedByEmail,
        requestedByRole: "agent",
        trigger: "webhook"
      });

      if (result.status === "ok" && result.deployment) {
        queued += 1;
        await recordPreviewWebhookLifecycleEvent({
          providerType: input.providerType,
          repoFullName: input.repoFullName,
          projectId: project.id,
          serviceId: service.id,
          actorEmail: input.requestedByEmail,
          previewKey,
          previewAction: input.preview.action,
          eventAction: input.eventAction,
          outcome: "queued",
          summary: `Queued preview ${input.preview.action} for ${service.name}.`,
          detail: `DaoFlow queued ${previewKey} ${input.preview.action} from ${input.providerType} ${input.eventType}.`,
          commitSha: input.commitSha,
          deploymentId: result.deployment.id,
          metadata: {
            deliveryKey: input.deliveryKey
          }
        });
        continue;
      }

      failedTargets.push({
        serviceId: service.id,
        status: result.status,
        entity: result.status === "not_found" ? result.entity : undefined,
        message: readPreviewFailureMessage(result)
      });
      await recordPreviewWebhookLifecycleEvent({
        providerType: input.providerType,
        repoFullName: input.repoFullName,
        projectId: project.id,
        serviceId: service.id,
        actorEmail: input.requestedByEmail,
        previewKey,
        previewAction: input.preview.action,
        eventAction: input.eventAction,
        outcome: "failed",
        summary: `Preview ${input.preview.action} could not be queued for ${service.name}.`,
        detail:
          readPreviewFailureMessage(result) ??
          `DaoFlow could not queue ${previewKey} ${input.preview.action} for ${service.name}.`,
        commitSha: input.commitSha,
        metadata: {
          deliveryKey: input.deliveryKey,
          status: result.status,
          entity: result.status === "not_found" ? result.entity : null
        }
      });
    }
  }

  const outcome = resolvePreviewDeliveryOutcome({
    queued,
    deduped,
    ignored,
    failedTargets: failedTargets.length
  });

  await completeWebhookDelivery({
    providerType: input.providerType,
    deliveryKey: input.deliveryKey,
    outcome,
    detail: `Queued ${queued}, deduped ${deduped}, ignored ${ignored}, failed ${failedTargets.length}.`,
    metadata: {
      eventAction: input.eventAction,
      previewKey,
      previewAction: input.preview.action,
      commitSha: input.commitSha,
      queued,
      deduped,
      ignored,
      failedTargets
    }
  });

  if (failedTargets.length > 0) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: "Preview webhook skipped one or more targets",
        providerType: input.providerType,
        repoFullName: input.repoFullName,
        previewKey,
        action: input.preview.action,
        commitSha: input.commitSha,
        failedTargets
      })
    );
  }

  return {
    ok: true,
    action: input.preview.action,
    previewKey,
    deployments: queued,
    dedupedTargets: deduped,
    ignoredTargets: ignored,
    failedTargets: failedTargets.length,
    branch: input.preview.branch,
    commit: summarizeCommit(input.commitSha)
  };
}
