import type { Context } from "hono";
import { claimWebhookDelivery, finalizeWebhookDelivery } from "../db/services/webhook-deliveries";
import { buildWebhookDeliveryKey, readGitHubPreviewLifecycle } from "../webhook-preview-lifecycle";
import {
  collectChangedPaths,
  determineWebhookDeliveryStatus,
  listWebhookTargets,
  verifyGitHubSignature,
  writeWebhookAuditEntry
} from "./webhooks-delivery";
import { processWebhookPushTargets } from "./webhooks-push";
import { triggerPreviewWebhookDeploys } from "./webhooks-preview";
import type { GitHubPushEvent } from "./webhooks-types";

function summarizeCommit(commitSha: string) {
  return commitSha ? commitSha.slice(0, 7) : "unknown";
}

export async function handleGitHubWebhook(c: Context) {
  let claimedDelivery: {
    deliveryKey: string;
  } | null = null;

  try {
    const event = c.req.header("x-github-event");
    if (!event) {
      return c.json({ ok: false, error: "Missing event type" }, 400);
    }

    if (event !== "push" && event !== "pull_request") {
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
    const matchingTargets = await listWebhookTargets({
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

    if (event === "pull_request") {
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
    const deliveryClaim = await claimWebhookDelivery({
      providerType: "github",
      eventType: event,
      rawBody,
      deliveryId,
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

    claimedDelivery = {
      deliveryKey: deliveryClaim.deliveryKey
    };

    if (deliveryClaim.status === "duplicate") {
      await writeWebhookAuditEntry({
        providerType: "github",
        repoFullName,
        actorId: "github-webhook",
        actorEmail: requestedByEmail,
        action: "webhook.delivery.duplicate",
        inputSummary: `Ignored duplicate GitHub push delivery for ${branch}@${summarizeCommit(commitSha)}`,
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
      providerType: "github",
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
      externalInstallationId,
      deploymentCount: result.deployments.length,
      failedTargetCount: result.failedTargets.length,
      ignoredTargetCount: result.ignoredTargets.length,
      failedTargets: result.failedTargets,
      ignoredTargets: result.ignoredTargets,
      changedPaths
    };
    await finalizeWebhookDelivery({
      providerType: "github",
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
    if (claimedDelivery) {
      await finalizeWebhookDelivery({
        providerType: "github",
        deliveryKey: claimedDelivery.deliveryKey,
        status: "failed",
        metadata: {
          error: err instanceof Error ? err.message : String(err)
        }
      });
    }

    console.error("[webhook/github] Error:", err);
    return c.json({ ok: false, error: "Internal error" }, 500);
  }
}
