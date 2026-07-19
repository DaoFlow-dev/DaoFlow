import type { Context } from "hono";
import { buildWebhookDeliveryKey as buildTransportDeliveryKey } from "../db/services/webhook-deliveries";
import { buildWebhookDeliveryKey, readGitLabPreviewLifecycle } from "../webhook-preview-lifecycle";
import {
  collectChangedPaths,
  verifyGitLabToken,
  writeWebhookAuditEntry
} from "./webhooks-delivery";
import { listWebhookTargets } from "./webhooks-delivery";
import { listDevelopmentTaskWebhookTargets } from "./webhooks-development-tasks";
import {
  processGitLabDevelopmentTaskTrigger,
  readGitLabDevelopmentTaskTrigger
} from "./webhooks-development-tasks-gitlab";
import { processWebhookPushTargets } from "./webhooks-push";
import { discoverWebhookPushTargetKeys } from "./webhook-push-target-discovery";
import {
  claimRecoverableWebhookDelivery,
  createWebhookPushRecoveryContext
} from "./webhook-push-recovery";
import { respondToNonActiveWebhookClaim } from "./webhook-push-claim-response";
import { triggerPreviewWebhookDeploys } from "./webhooks-preview";
import type { GitLabPushEvent, WebhookTarget } from "./webhooks-types";

function normalizeOrigin(value?: string | null) {
  if (!value) {
    return null;
  }

  try {
    return new URL(value).origin.replace(/\/+$/, "").toLowerCase();
  } catch {
    return null;
  }
}

function providerOrigin(target: WebhookTarget) {
  return normalizeOrigin(target.provider.baseUrl) ?? "https://gitlab.com";
}

function payloadProjectOrigin(payload: GitLabPushEvent) {
  return normalizeOrigin(payload.project?.web_url);
}

function filterGitLabTargetsByPayloadOrigin(targets: WebhookTarget[], payload: GitLabPushEvent) {
  const origin = payloadProjectOrigin(payload);
  if (!origin) {
    return targets;
  }

  return targets.filter((target) => providerOrigin(target) === origin);
}

export async function handleGitLabWebhook(c: Context) {
  let recoveryContext: Awaited<ReturnType<typeof createWebhookPushRecoveryContext>> | null = null;

  try {
    const token = c.req.header("x-gitlab-token");
    if (!token) {
      return c.json({ ok: false, error: "Missing token" }, 401);
    }

    const rawBody = await c.req.text();
    const payload = JSON.parse(rawBody) as GitLabPushEvent;
    const repoFullName = payload.project?.path_with_namespace;
    if (!repoFullName) {
      return c.json({ ok: false, error: "Missing project" }, 400);
    }

    const gitlabEvent = (c.req.header("x-gitlab-event") ?? "").toLowerCase();
    const isDevelopmentTaskEvent = gitlabEvent.includes("issue") || gitlabEvent.includes("note");
    const matchingTargets = isDevelopmentTaskEvent
      ? await listDevelopmentTaskWebhookTargets({
          repoFullName,
          providerType: "gitlab"
        })
      : await listWebhookTargets({
          repoFullName,
          providerType: "gitlab"
        });

    const originMatchedTargets = filterGitLabTargetsByPayloadOrigin(matchingTargets, payload);

    if (originMatchedTargets.length === 0) {
      return c.json({ ok: true, skipped: true, reason: "no matching projects" });
    }

    const verifiedProviderIds = [
      ...new Set(
        originMatchedTargets
          .filter(
            ({ provider }) =>
              Boolean(provider.webhookSecret) && verifyGitLabToken(token, provider.webhookSecret!)
          )
          .map(({ provider }) => provider.id)
      )
    ];

    if (verifiedProviderIds.length === 0) {
      return c.json({ ok: false, error: "Invalid token" }, 401);
    }

    const verifiedTargets = originMatchedTargets.filter(({ provider }) =>
      verifiedProviderIds.includes(provider.id)
    );

    if (isDevelopmentTaskEvent) {
      const trigger = readGitLabDevelopmentTaskTrigger(gitlabEvent, payload);
      if (!trigger) {
        return c.json({ ok: true, skipped: true, reason: "unsupported development task trigger" });
      }

      return c.json(
        await processGitLabDevelopmentTaskTrigger({
          event: gitlabEvent,
          rawBody,
          deliveryId: c.req.header("x-gitlab-event-uuid") ?? c.req.header("x-gitlab-webhook-uuid"),
          payload,
          repoFullName,
          matchingTargets: verifiedTargets,
          trigger
        })
      );
    }

    const lifecycle = readGitLabPreviewLifecycle(payload);
    if (gitlabEvent.includes("merge request") || lifecycle) {
      if (!lifecycle) {
        return c.json({ ok: true, skipped: true, reason: "unsupported merge_request action" });
      }

      return c.json(
        await triggerPreviewWebhookDeploys({
          providerType: "gitlab",
          repoFullName,
          matchingTargets: verifiedTargets,
          deliveryKey: buildWebhookDeliveryKey({
            providerType: "gitlab",
            headerValue:
              c.req.header("x-gitlab-event-uuid") ?? c.req.header("x-gitlab-webhook-uuid"),
            rawBody
          }),
          eventType: "merge_request",
          eventAction: lifecycle.eventAction,
          requestedByEmail: lifecycle.requestedByEmail,
          commitSha: lifecycle.commitSha,
          origin: {
            ...lifecycle.origin,
            installationVerified: true
          },
          preview: {
            target: "pull-request",
            branch: lifecycle.preview.branch,
            pullRequestNumber: lifecycle.preview.pullRequestNumber!,
            action: lifecycle.preview.action ?? "deploy"
          }
        })
      );
    }

    const deliveryId = c.req.header("x-gitlab-event-uuid") ?? c.req.header("x-gitlab-webhook-uuid");
    const branch = (payload.ref ?? "").replace("refs/heads/", "");
    const commitSha = payload.checkout_sha ?? payload.after ?? "";
    const changedPaths = collectChangedPaths(payload.commits);
    const requestedByEmail = payload.user_name ?? "gitlab-webhook";
    const { deliveryKey } = buildTransportDeliveryKey({
      providerType: "gitlab",
      eventType: "push",
      rawBody,
      deliveryId
    });
    const deliveryClaim = await claimRecoverableWebhookDelivery({
      providerType: "gitlab",
      eventType: "push",
      deliveryKey,
      providerDeliveryId: deliveryId,
      rawBody,
      repoFullName,
      commitSha,
      metadata: {
        repoFullName,
        branch,
        commitSha,
        changedPaths
      }
    });

    if (deliveryClaim.kind !== "new" && deliveryClaim.kind !== "reclaimed") {
      return respondToNonActiveWebhookClaim({
        context: c,
        claim: deliveryClaim,
        providerType: "gitlab",
        repoFullName,
        branch,
        commitSha,
        actorId: "gitlab-webhook",
        actorEmail: requestedByEmail,
        providerDeliveryId: deliveryId,
        deliveryKey
      });
    }

    recoveryContext = await createWebhookPushRecoveryContext(deliveryClaim);
    await recoveryContext.registerDiscoveredTargets(
      await discoverWebhookPushTargetKeys({
        branch,
        changedPaths,
        matchingTargets: verifiedTargets
      })
    );

    if (recoveryContext.hasNoWork) {
      await recoveryContext.complete({
        deploymentCount: 0,
        failedTargetCount: 0,
        ignoredTargetCount: 0,
        detail: "Recovered webhook delivery finalization without replaying completed targets."
      });
      return c.json({ ok: true, skipped: true, reason: "delivery targets already completed" });
    }

    const result = await processWebhookPushTargets({
      providerType: "gitlab",
      repoFullName,
      branch,
      commitSha,
      changedPaths,
      requestedByEmail,
      matchingTargets: verifiedTargets,
      deliveryKey,
      shouldProcessTarget: recoveryContext.shouldProcessTarget.bind(recoveryContext),
      onTargetStarted: recoveryContext.onTargetStarted.bind(recoveryContext),
      onTargetOutcome: recoveryContext.onTargetOutcome.bind(recoveryContext),
      webhookDeliveryId: recoveryContext.deliveryId,
      findRecoveredDeployment: recoveryContext.findRecoveredDeployment.bind(recoveryContext)
    });

    const safeFailedTargets = result.failedTargets.map((target) => ({
      projectId: target.projectId,
      projectName: target.projectName,
      serviceId: target.serviceId,
      status: target.status,
      entity: target.entity
    }));
    const metadata = {
      repoFullName,
      branch,
      commitSha,
      deliveryId: deliveryId ?? null,
      deliveryKey,
      deploymentCount: result.deployments.length,
      failedTargetCount: result.failedTargets.length,
      ignoredTargetCount: result.ignoredTargets.length,
      failedTargets: safeFailedTargets,
      ignoredTargets: result.ignoredTargets,
      changedPaths
    };
    await recoveryContext.complete({
      deploymentCount: result.deployments.length,
      failedTargetCount: result.failedTargets.length,
      ignoredTargetCount: result.ignoredTargets.length,
      detail: `Processed GitLab push with ${result.deployments.length} queued, ${result.failedTargets.length} failed, and ${result.ignoredTargets.length} ignored targets.`
    });

    if (result.failedTargets.length > 0) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "GitLab webhook auto-deploy skipped or failed one or more targets",
          ...metadata
        })
      );
    }

    await writeWebhookAuditEntry({
      providerType: "gitlab",
      repoFullName,
      actorId: "gitlab-webhook",
      actorEmail: requestedByEmail,
      action: "webhook.push",
      inputSummary:
        result.ignoredTargets.length > 0
          ? `GitLab push to ${branch} (${commitSha.slice(0, 7)}) queued ${result.deployments.length} deployments, ignored ${result.ignoredTargets.length} targets, and failed ${result.failedTargets.length} targets`
          : `GitLab push to ${branch} (${commitSha.slice(0, 7)}) queued ${result.deployments.length} deployments and failed ${result.failedTargets.length} targets`,
      outcome: result.failedTargets.length > 0 ? "failure" : "success",
      metadata
    });

    return c.json({
      ok: true,
      deployments: result.deployments.length,
      failedTargets: result.failedTargets.length,
      ignoredTargets: result.ignoredTargets.length,
      branch,
      commit: commitSha.slice(0, 7)
    });
  } catch (err) {
    if (recoveryContext) {
      await recoveryContext.fail().catch(() => undefined);
    }

    console.error(
      "[webhook/gitlab] Webhook processing failed.",
      err instanceof Error ? err.name : "UnknownError"
    );
    return c.json({ ok: false, error: "Internal error" }, 500);
  }
}
