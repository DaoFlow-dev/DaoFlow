import type { Context } from "hono";
import { claimWebhookDelivery, finalizeWebhookDelivery } from "../db/services/webhook-deliveries";
import { buildWebhookDeliveryKey, readGitLabPreviewLifecycle } from "../webhook-preview-lifecycle";
import {
  collectChangedPaths,
  determineWebhookDeliveryStatus,
  listWebhookTargets,
  verifyGitLabToken,
  writeWebhookAuditEntry
} from "./webhooks-delivery";
import { processWebhookPushTargets } from "./webhooks-push";
import { triggerPreviewWebhookDeploys } from "./webhooks-preview";
import type { GitLabPushEvent } from "./webhooks-types";

function summarizeCommit(commitSha: string) {
  return commitSha ? commitSha.slice(0, 7) : "unknown";
}

export async function handleGitLabWebhook(c: Context) {
  let claimedDelivery: {
    deliveryKey: string;
  } | null = null;

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

    const matchingTargets = await listWebhookTargets({
      repoFullName,
      providerType: "gitlab"
    });

    if (matchingTargets.length === 0) {
      return c.json({ ok: true, skipped: true, reason: "no matching projects" });
    }

    const verifiedProviderIds = [
      ...new Set(
        matchingTargets
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

    const verifiedTargets = matchingTargets.filter(({ provider }) =>
      verifiedProviderIds.includes(provider.id)
    );

    const gitlabEvent = (c.req.header("x-gitlab-event") ?? "").toLowerCase();
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
    const deliveryClaim = await claimWebhookDelivery({
      providerType: "gitlab",
      eventType: "push",
      rawBody,
      deliveryId,
      repoFullName,
      commitSha,
      metadata: {
        repoFullName,
        branch,
        commitSha,
        changedPaths
      }
    });

    claimedDelivery = {
      deliveryKey: deliveryClaim.deliveryKey
    };

    if (deliveryClaim.status === "duplicate") {
      await writeWebhookAuditEntry({
        providerType: "gitlab",
        repoFullName,
        actorId: "gitlab-webhook",
        actorEmail: requestedByEmail,
        action: "webhook.delivery.duplicate",
        inputSummary: `Ignored duplicate GitLab push delivery for ${branch}@${summarizeCommit(commitSha)}`,
        outcome: "success",
        metadata: {
          repoFullName,
          branch,
          commitSha,
          deliveryId: deliveryId ?? null,
          deliveryKey: deliveryClaim.deliveryKey
        }
      });
      return c.json({ ok: true, skipped: true, reason: "duplicate delivery" });
    }

    const result = await processWebhookPushTargets({
      providerType: "gitlab",
      repoFullName,
      branch,
      commitSha,
      changedPaths,
      requestedByEmail,
      matchingTargets: verifiedTargets,
      deliveryKey: deliveryClaim.deliveryKey
    });

    const metadata = {
      repoFullName,
      branch,
      commitSha,
      deliveryId: deliveryId ?? null,
      deliveryKey: deliveryClaim.deliveryKey,
      deploymentCount: result.deployments.length,
      failedTargetCount: result.failedTargets.length,
      ignoredTargetCount: result.ignoredTargets.length,
      failedTargets: result.failedTargets,
      ignoredTargets: result.ignoredTargets,
      changedPaths
    };
    await finalizeWebhookDelivery({
      providerType: "gitlab",
      deliveryKey: deliveryClaim.deliveryKey,
      status: determineWebhookDeliveryStatus({
        deploymentCount: result.deployments.length,
        failedTargetCount: result.failedTargets.length
      }),
      metadata
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
    if (claimedDelivery) {
      await finalizeWebhookDelivery({
        providerType: "gitlab",
        deliveryKey: claimedDelivery.deliveryKey,
        status: "failed",
        metadata: {
          error: err instanceof Error ? err.message : String(err)
        }
      });
    }

    console.error("[webhook/gitlab] Error:", err);
    return c.json({ ok: false, error: "Internal error" }, 500);
  }
}
