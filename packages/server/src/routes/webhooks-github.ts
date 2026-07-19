import type { Context } from "hono";
import { buildWebhookDeliveryKey as buildTransportDeliveryKey } from "../db/services/webhook-deliveries";
import { buildWebhookDeliveryKey, readGitHubPreviewLifecycle } from "../webhook-preview-lifecycle";
import {
  collectChangedPaths,
  listWebhookTargets,
  verifyGitHubSignature,
  writeWebhookAuditEntry
} from "./webhooks-delivery";
import {
  listDevelopmentTaskWebhookTargets,
  processGitHubDevelopmentTaskTrigger,
  readGitHubDevelopmentTaskTrigger
} from "./webhooks-development-tasks";
import { processWebhookPushTargets } from "./webhooks-push";
import { discoverWebhookPushTargetKeys } from "./webhook-push-target-discovery";
import {
  claimRecoverableWebhookDelivery,
  createWebhookPushRecoveryContext
} from "./webhook-push-recovery";
import { respondToNonActiveWebhookClaim } from "./webhook-push-claim-response";
import { triggerPreviewWebhookDeploys } from "./webhooks-preview";
import type { GitHubPushEvent } from "./webhooks-types";

export async function handleGitHubWebhook(c: Context) {
  let recoveryContext: Awaited<ReturnType<typeof createWebhookPushRecoveryContext>> | null = null;

  try {
    const event = c.req.header("x-github-event");
    if (!event) {
      return c.json({ ok: false, error: "Missing event type" }, 400);
    }

    if (
      event !== "push" &&
      event !== "pull_request" &&
      event !== "issues" &&
      event !== "issue_comment"
    ) {
      return c.json({ ok: true, skipped: true, reason: `unsupported event ${event}` });
    }

    const signature = c.req.header("x-hub-signature-256");
    if (!signature) {
      return c.json({ ok: false, error: "Missing signature" }, 401);
    }

    const rawBody = await c.req.text();
    const payload = JSON.parse(rawBody) as GitHubPushEvent;
    const repoFullName = payload.repository?.full_name;
    if (!repoFullName) {
      return c.json({ ok: false, error: "Missing repository" }, 400);
    }

    const externalInstallationId = payload.installation?.id
      ? String(payload.installation.id)
      : null;
    const isDevelopmentTaskEvent = event === "issues" || event === "issue_comment";
    const matchingTargets = isDevelopmentTaskEvent
      ? await listDevelopmentTaskWebhookTargets({
          repoFullName,
          providerType: "github",
          externalInstallationId
        })
      : await listWebhookTargets({
          repoFullName,
          providerType: "github",
          externalInstallationId
        });

    if (matchingTargets.length === 0) {
      return c.json({ ok: true, skipped: true, reason: "no matching projects" });
    }

    const verifiedProviderIds = [
      ...new Set(
        matchingTargets
          .filter(
            ({ provider }) =>
              Boolean(provider.webhookSecret) &&
              verifyGitHubSignature(rawBody, signature, provider.webhookSecret!)
          )
          .map(({ provider }) => provider.id)
      )
    ];

    if (verifiedProviderIds.length === 0) {
      return c.json({ ok: false, error: "Invalid signature" }, 401);
    }

    const verifiedTargets = matchingTargets.filter(({ provider }) =>
      verifiedProviderIds.includes(provider.id)
    );

    if (isDevelopmentTaskEvent) {
      const trigger = readGitHubDevelopmentTaskTrigger(event, payload);
      if (!trigger) {
        return c.json({ ok: true, skipped: true, reason: "unsupported development task trigger" });
      }

      return c.json(
        await processGitHubDevelopmentTaskTrigger({
          event,
          rawBody,
          deliveryId: c.req.header("x-github-delivery"),
          payload,
          repoFullName,
          externalInstallationId,
          matchingTargets: verifiedTargets,
          trigger
        })
      );
    }

    if (event === "pull_request") {
      if (!externalInstallationId) {
        return c.json(
          { ok: false, error: "GitHub pull request webhook is missing installation identity." },
          400
        );
      }
      const lifecycle = readGitHubPreviewLifecycle(payload);
      if (!lifecycle) {
        return c.json({ ok: true, skipped: true, reason: "unsupported pull_request action" });
      }

      return c.json(
        await triggerPreviewWebhookDeploys({
          providerType: "github",
          repoFullName,
          matchingTargets: verifiedTargets,
          deliveryKey: buildWebhookDeliveryKey({
            providerType: "github",
            headerValue: c.req.header("x-github-delivery"),
            rawBody
          }),
          eventType: event,
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

    const deliveryId = c.req.header("x-github-delivery");
    const branch = (payload.ref ?? "").replace("refs/heads/", "");
    const commitSha = payload.after ?? "";
    const changedPaths = collectChangedPaths(payload.commits);
    const requestedByEmail = payload.sender?.login ?? "github-webhook";
    const { deliveryKey } = buildTransportDeliveryKey({
      providerType: "github",
      eventType: event,
      rawBody,
      deliveryId
    });
    const deliveryClaim = await claimRecoverableWebhookDelivery({
      providerType: "github",
      eventType: event,
      deliveryKey,
      providerDeliveryId: deliveryId,
      rawBody,
      repoFullName,
      externalInstallationId,
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
        providerType: "github",
        repoFullName,
        branch,
        commitSha,
        actorId: "github-webhook",
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
        deleted: payload.deleted === true,
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
      providerType: "github",
      repoFullName,
      branch,
      commitSha,
      changedPaths,
      deleted: payload.deleted === true,
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
      externalInstallationId,
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
      detail: `Processed GitHub push with ${result.deployments.length} queued, ${result.failedTargets.length} failed, and ${result.ignoredTargets.length} ignored targets.`
    });

    if (result.failedTargets.length > 0) {
      console.warn(
        JSON.stringify({
          level: "warn",
          message: "GitHub webhook auto-deploy skipped or failed one or more targets",
          ...metadata
        })
      );
    }

    await writeWebhookAuditEntry({
      providerType: "github",
      repoFullName,
      actorId: "github-webhook",
      actorEmail: requestedByEmail,
      action: "webhook.push",
      inputSummary:
        result.ignoredTargets.length > 0
          ? `GitHub push to ${branch} (${commitSha.slice(0, 7)}) queued ${result.deployments.length} deployments, ignored ${result.ignoredTargets.length} targets, and failed ${result.failedTargets.length} targets`
          : `GitHub push to ${branch} (${commitSha.slice(0, 7)}) queued ${result.deployments.length} deployments and failed ${result.failedTargets.length} targets`,
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
      "[webhook/github] Webhook processing failed.",
      err instanceof Error ? err.name : "UnknownError"
    );
    return c.json({ ok: false, error: "Internal error" }, 500);
  }
}
