import {
  beginWebhookDelivery,
  completeWebhookDelivery,
  findLatestPreviewDeploymentForService,
  listEligiblePreviewWebhookServices,
  recordPreviewWebhookLifecycleEvent
} from "../db/services/webhook-deliveries";
import { createOrReusePreviewApprovalRequest } from "../db/services/approvals";
import { triggerDeploy } from "../db/services/trigger-deploy";
import {
  buildPreviewApprovalBinding,
  evaluatePreviewPolicy,
  readPreviewPolicy,
  type PreviewOrigin
} from "../preview-trust";
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
  origin: PreviewOrigin;
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
      origin: input.origin,
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
          origin: input.origin,
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
  let approvalRequired = 0;
  let blocked = 0;
  const failedTargets: PreviewWebhookDeployFailure[] = [];

  for (const { project, installation } of input.matchingTargets) {
    const origin =
      input.origin.installationOwner || !installation
        ? input.origin
        : { ...input.origin, installationOwner: installation.accountName };
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

    const policy = readPreviewPolicy(project.previewPolicy);
    const policyDecision =
      input.preview.action === "deploy"
        ? evaluatePreviewPolicy({ policy, origin })
        : {
            decision: "allowed" as const,
            reason: "Preview cleanup does not prepare source code or environment secrets."
          };

    if (policyDecision.decision === "blocked") {
      for (const service of eligibleServices) {
        blocked += 1;
        await recordPreviewWebhookLifecycleEvent({
          providerType: input.providerType,
          repoFullName: input.repoFullName,
          projectId: project.id,
          serviceId: service.id,
          actorEmail: input.requestedByEmail,
          previewKey,
          previewAction: input.preview.action,
          eventAction: input.eventAction,
          outcome: "blocked",
          summary: `Blocked preview ${input.preview.action} for ${service.name}.`,
          detail: policyDecision.reason,
          commitSha: input.commitSha,
          metadata: {
            deliveryKey: input.deliveryKey,
            policy,
            policyRevision: project.previewPolicyRevision,
            origin,
            decision: policyDecision.decision
          }
        });
      }
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
            source: "semantic-preview-dedupe",
            policy,
            policyRevision: project.previewPolicyRevision,
            origin
          }
        });
        continue;
      }

      if (input.preview.action === "deploy") {
        if (policyDecision.decision === "approval-required") {
          const sourceRepository = origin.sourceRepository;
          if (!sourceRepository || !project.gitProviderId || !project.gitInstallationId) {
            blocked += 1;
            await recordPreviewWebhookLifecycleEvent({
              providerType: input.providerType,
              repoFullName: input.repoFullName,
              projectId: project.id,
              serviceId: service.id,
              actorEmail: input.requestedByEmail,
              previewKey,
              previewAction: input.preview.action,
              eventAction: input.eventAction,
              outcome: "blocked",
              summary: `Blocked preview deploy for ${service.name}.`,
              detail:
                "DaoFlow could not bind an approval because the source repository, provider, or installation identity was missing.",
              commitSha: input.commitSha,
              metadata: {
                deliveryKey: input.deliveryKey,
                policy,
                policyRevision: project.previewPolicyRevision,
                origin,
                decision: "blocked"
              }
            });
            continue;
          }

          const approval = await createOrReusePreviewApprovalRequest({
            actionType: "preview-deployment",
            serviceId: service.id,
            previewTrust: buildPreviewApprovalBinding({
              providerType: input.providerType,
              providerId: project.gitProviderId,
              installationId: project.gitInstallationId,
              sourceRepository,
              baseRepository: input.repoFullName,
              commitSha: input.commitSha,
              policyRevision: project.previewPolicyRevision,
              origin,
              serviceId: service.id,
              preview: input.preview
            }),
            reason: `Verified ${input.providerType} pull-request preview requires human approval for ${input.commitSha.slice(0, 12)}.`,
            teamId: project.teamId,
            requestedByUserId: null,
            requestedByEmail: input.requestedByEmail,
            requestedByRole: "agent"
          });

          if (approval.status === "invalid" || !approval.request) {
            failedTargets.push({
              serviceId: service.id,
              status: "approval_invalid",
              message: "DaoFlow could not create the bound preview approval request."
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
              summary: `Preview deploy could not request approval for ${service.name}.`,
              detail: "DaoFlow could not create the bound preview approval request.",
              commitSha: input.commitSha,
              metadata: {
                deliveryKey: input.deliveryKey,
                policy,
                policyRevision: project.previewPolicyRevision,
                origin,
                decision: "approval-request-failed"
              }
            });
            continue;
          }

          if (approval.status === "created") {
            approvalRequired += 1;
            await recordPreviewWebhookLifecycleEvent({
              providerType: input.providerType,
              repoFullName: input.repoFullName,
              projectId: project.id,
              serviceId: service.id,
              actorEmail: input.requestedByEmail,
              previewKey,
              previewAction: input.preview.action,
              eventAction: input.eventAction,
              outcome: "approval_required",
              summary: `Preview deploy for ${service.name} is waiting for human approval.`,
              detail: policyDecision.reason,
              commitSha: input.commitSha,
              metadata: {
                deliveryKey: input.deliveryKey,
                approvalRequestId: approval.request.id,
                policy,
                policyRevision: project.previewPolicyRevision,
                origin,
                decision: "approval-required"
              }
            });
            continue;
          }

          if (approval.status === "pending") {
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
              summary: `Reused pending preview approval for ${service.name}.`,
              detail: "The exact provider commit is already waiting for human approval.",
              commitSha: input.commitSha,
              metadata: {
                deliveryKey: input.deliveryKey,
                approvalRequestId: approval.request.id,
                policy,
                policyRevision: project.previewPolicyRevision,
                origin,
                source: "pending-preview-approval"
              }
            });
            continue;
          }
        }
      }

      const result = await triggerDeploy({
        serviceId: service.id,
        commitSha: input.commitSha || undefined,
        preview: input.preview,
        previewProviderType: input.providerType,
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
            deliveryKey: input.deliveryKey,
            policy,
            policyRevision: project.previewPolicyRevision,
            origin,
            decision: input.preview.action === "deploy" ? policyDecision.decision : "cleanup"
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
          entity: result.status === "not_found" ? result.entity : null,
          policy,
          policyRevision: project.previewPolicyRevision,
          origin,
          decision: input.preview.action === "deploy" ? policyDecision.decision : "cleanup"
        }
      });
    }
  }

  const outcome = resolvePreviewDeliveryOutcome({
    queued,
    deduped,
    ignored,
    approvalRequired,
    blocked,
    failedTargets: failedTargets.length
  });

  await completeWebhookDelivery({
    providerType: input.providerType,
    deliveryKey: input.deliveryKey,
    outcome,
    detail: `Queued ${queued}, awaiting approval ${approvalRequired}, blocked ${blocked}, deduped ${deduped}, ignored ${ignored}, failed ${failedTargets.length}.`,
    metadata: {
      eventAction: input.eventAction,
      previewKey,
      previewAction: input.preview.action,
      commitSha: input.commitSha,
      queued,
      deduped,
      ignored,
      approvalRequired,
      blocked,
      origin: input.origin,
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
    approvalRequiredTargets: approvalRequired,
    blockedTargets: blocked,
    dedupedTargets: deduped,
    ignoredTargets: ignored,
    failedTargets: failedTargets.length,
    branch: input.preview.branch,
    commit: summarizeCommit(input.commitSha)
  };
}
