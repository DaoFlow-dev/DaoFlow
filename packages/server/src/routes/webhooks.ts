/**
 * webhooks.ts — Hono webhook receiver routes.
 *
 * NOT tRPC — these are standard Hono routes because:
 * 1. Webhook payloads require raw body for HMAC validation
 * 2. GitHub/GitLab send POST with specific content types
 * 3. No auth token — authenticated via HMAC signature or provider token
 */

import { createHmac, timingSafeEqual } from "node:crypto";
import { Hono } from "hono";
import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/connection";
import { auditEntries } from "../db/schema/audit";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import {
  beginWebhookDelivery,
  claimWebhookDelivery,
  completeWebhookDelivery,
  finalizeWebhookDelivery,
  findLatestPreviewDeploymentForService,
  listEligiblePreviewWebhookServices,
  recordPreviewWebhookLifecycleEvent
} from "../db/services/webhook-deliveries";
import { triggerDeploy } from "../db/services/trigger-deploy";
import { asRecord } from "../db/services/json-helpers";
import { readComposePreviewMetadata } from "../compose-preview";
import {
  collectChangedPaths,
  determineWebhookDeliveryStatus,
  processWebhookPushTargets
} from "./webhooks-shared";
import {
  buildWebhookDeliveryKey,
  readGitHubPreviewLifecycle,
  readGitLabPreviewLifecycle
} from "../webhook-preview-lifecycle";

type ProviderType = "github" | "gitlab";

interface WebhookCommitChangeSet {
  added?: string[];
  modified?: string[];
  removed?: string[];
}

interface GitHubPushEvent {
  ref?: string;
  after?: string;
  repository?: { full_name?: string };
  sender?: { login?: string };
  installation?: { id?: number };
  commits?: WebhookCommitChangeSet[];
}

interface GitLabPushEvent {
  ref?: string;
  after?: string;
  checkout_sha?: string;
  project?: { path_with_namespace?: string };
  user_name?: string;
  commits?: WebhookCommitChangeSet[];
}

interface WebhookDeployFailure {
  serviceId: string;
  status: string;
  entity?: string;
  message?: string;
}

type WebhookTarget = {
  project: typeof projects.$inferSelect;
  provider: typeof gitProviders.$inferSelect;
  installation: typeof gitInstallations.$inferSelect | null;
};

function verifyGitHubSignature(payload: string, signature: string, secret: string): boolean {
  try {
    const expected = "sha256=" + createHmac("sha256", secret).update(payload).digest("hex");
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

function verifyGitLabToken(token: string, expected: string): boolean {
  try {
    return timingSafeEqual(Buffer.from(token), Buffer.from(expected));
  } catch {
    return false;
  }
}

function summarizeCommit(commitSha: string) {
  return commitSha ? commitSha.slice(0, 7) : "unknown";
}

function readPreviewFailureMessage(result: { status: string; entity?: string; message?: string }) {
  if (result.status === "not_found" && result.entity) {
    return `Missing ${result.entity}.`;
  }

  return result.message;
}

function shouldDeduplicatePreviewRequest(input: {
  latestDeployment: typeof import("../db/schema/deployments").deployments.$inferSelect | null;
  commitSha: string;
  requestedAction: "deploy" | "destroy";
}) {
  if (!input.latestDeployment) {
    return false;
  }

  const preview = readComposePreviewMetadata(
    asRecord(input.latestDeployment.configSnapshot).preview
  );
  if (!preview || preview.action !== input.requestedAction) {
    return false;
  }

  const conclusion = (input.latestDeployment.conclusion ?? "").toLowerCase();
  if (
    input.latestDeployment.status === "failed" ||
    conclusion === "failed" ||
    conclusion === "canceled" ||
    conclusion === "cancelled"
  ) {
    return false;
  }

  if (input.requestedAction === "destroy") {
    return true;
  }

  return (input.latestDeployment.commitSha ?? "") === input.commitSha;
}

function resolvePreviewDeliveryOutcome(input: {
  queued: number;
  deduped: number;
  ignored: number;
  failedTargets: number;
}) {
  if (
    (input.queued > 0 && (input.deduped > 0 || input.ignored > 0 || input.failedTargets > 0)) ||
    (input.failedTargets > 0 && (input.deduped > 0 || input.ignored > 0))
  ) {
    return "mixed" as const;
  }
  if (input.queued > 0) {
    return "queued" as const;
  }
  if (input.failedTargets > 0) {
    return "failed" as const;
  }
  if (input.deduped > 0 && input.ignored === 0) {
    return "deduped" as const;
  }
  return "ignored" as const;
}

async function listWebhookTargets(input: {
  repoFullName: string;
  providerType: ProviderType;
  externalInstallationId?: string | null;
}): Promise<WebhookTarget[]> {
  const matchingProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.repoFullName, input.repoFullName), eq(projects.autoDeploy, true)));

  const providerIds = [
    ...new Set(
      matchingProjects
        .map((project) => project.gitProviderId)
        .filter((providerId): providerId is string => Boolean(providerId))
    )
  ];
  const installationIds = [
    ...new Set(
      matchingProjects
        .map((project) => project.gitInstallationId)
        .filter((installationId): installationId is string => Boolean(installationId))
    )
  ];

  if (providerIds.length === 0) {
    return [];
  }

  const [providerRows, installationRows] = await Promise.all([
    db.select().from(gitProviders).where(inArray(gitProviders.id, providerIds)),
    installationIds.length > 0
      ? db.select().from(gitInstallations).where(inArray(gitInstallations.id, installationIds))
      : Promise.resolve([])
  ]);
  const providerById = new Map(providerRows.map((provider) => [provider.id, provider]));
  const installationById = new Map(
    installationRows.map((installation) => [installation.id, installation])
  );

  return matchingProjects.flatMap((project) => {
    if (!project.gitProviderId) {
      return [];
    }

    const provider = providerById.get(project.gitProviderId);
    if (!provider || provider.type !== input.providerType) {
      return [];
    }

    const installation = project.gitInstallationId
      ? (installationById.get(project.gitInstallationId) ?? null)
      : null;

    if (
      input.externalInstallationId &&
      installation?.installationId !== input.externalInstallationId
    ) {
      return [];
    }

    return [{ project, provider, installation }];
  });
}

async function triggerPreviewWebhookDeploys(input: {
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
  const failedTargets: WebhookDeployFailure[] = [];

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

async function handlePushWebhook(input: {
  providerType: ProviderType;
  repoFullName: string;
  branch: string;
  commitSha: string;
  changedPaths: string[];
  deliveryId?: string | null;
  deliveryKey: string;
  externalInstallationId?: string | null;
  requestedByEmail: string;
  matchingTargets: WebhookTarget[];
}) {
  const result = await processWebhookPushTargets({
    providerType: input.providerType,
    repoFullName: input.repoFullName,
    branch: input.branch,
    commitSha: input.commitSha,
    changedPaths: input.changedPaths,
    requestedByEmail: input.requestedByEmail,
    matchingTargets: input.matchingTargets,
    deliveryKey: input.deliveryKey
  });

  if (result.failedTargets.length > 0) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: `${input.providerType} webhook auto-deploy skipped one or more targets`,
        repoFullName: input.repoFullName,
        branch: input.branch,
        commitSha: input.commitSha,
        failedTargets: result.failedTargets,
        ignoredTargets: result.ignoredTargets
      })
    );
  }

  await db.insert(auditEntries).values({
    actorType: "system",
    actorId: `${input.providerType}-webhook`,
    actorEmail: input.requestedByEmail,
    actorRole: "agent",
    targetResource: `webhook/${input.providerType}/${input.repoFullName}`,
    action: "webhook.push",
    inputSummary:
      result.ignoredTargets.length > 0
        ? `Push to ${input.branch} (${summarizeCommit(input.commitSha)}) → ${result.deployments.length} deployments, ${result.ignoredTargets.length} ignored targets, ${result.failedTargets.length} failures`
        : `Push to ${input.branch} (${summarizeCommit(input.commitSha)}) → ${result.deployments.length} deployments, ${result.failedTargets.length} failures`,
    permissionScope: "deploy:start",
    outcome: "success",
    metadata: {
      repoFullName: input.repoFullName,
      branch: input.branch,
      commitSha: input.commitSha,
      deliveryId: input.deliveryId ?? null,
      deliveryKey: input.deliveryKey,
      externalInstallationId: input.externalInstallationId ?? null,
      changedPaths: input.changedPaths,
      deploymentCount: result.deployments.length,
      failedTargetCount: result.failedTargets.length,
      ignoredTargetCount: result.ignoredTargets.length,
      failedTargets: result.failedTargets,
      ignoredTargets: result.ignoredTargets
    }
  });

  return {
    ok: true,
    deployments: result.deployments.length,
    failedTargets: result.failedTargets.length,
    ignoredTargets: result.ignoredTargets.length,
    branch: input.branch,
    commit: summarizeCommit(input.commitSha),
    deliveryStatus: determineWebhookDeliveryStatus({
      deploymentCount: result.deployments.length,
      failedTargetCount: result.failedTargets.length
    })
  };
}

export const webhooksRouter = new Hono();

webhooksRouter.post("/github", async (c) => {
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

    const verifiedTargets = matchingTargets.filter(
      ({ provider }) =>
        Boolean(provider.webhookSecret) &&
        verifyGitHubSignature(rawBody, signature, provider.webhookSecret!)
    );
    if (verifiedTargets.length === 0) {
      return c.json({ ok: false, error: "Invalid signature" }, 401);
    }

    if (event === "pull_request") {
      const lifecycle = readGitHubPreviewLifecycle(
        payload as Parameters<typeof readGitHubPreviewLifecycle>[0]
      );
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

    const pushPayload = JSON.parse(rawBody) as GitHubPushEvent;
    const deliveryId = c.req.header("x-github-delivery");
    const branch = (pushPayload.ref ?? "").replace("refs/heads/", "");
    const commitSha = pushPayload.after ?? "";
    const changedPaths = collectChangedPaths(pushPayload.commits);
    const requestedByEmail = pushPayload.sender?.login ?? "github-webhook";
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

    if (deliveryClaim.status === "duplicate") {
      return c.json({ ok: true, skipped: true, reason: "duplicate delivery" });
    }

    const response = await handlePushWebhook({
      providerType: "github",
      repoFullName,
      branch,
      commitSha,
      changedPaths,
      deliveryId,
      deliveryKey: deliveryClaim.deliveryKey,
      externalInstallationId,
      requestedByEmail,
      matchingTargets: verifiedTargets
    });
    await finalizeWebhookDelivery({
      providerType: "github",
      deliveryKey: deliveryClaim.deliveryKey,
      status: response.deliveryStatus,
      metadata: {
        repoFullName,
        branch,
        commitSha,
        deliveryId: deliveryId ?? null,
        deliveryKey: deliveryClaim.deliveryKey,
        externalInstallationId,
        deploymentCount: response.deployments,
        failedTargetCount: response.failedTargets,
        ignoredTargetCount: response.ignoredTargets,
        changedPaths
      }
    });

    return c.json({
      ok: response.ok,
      deployments: response.deployments,
      failedTargets: response.failedTargets,
      ignoredTargets: response.ignoredTargets,
      branch: response.branch,
      commit: response.commit
    });
  } catch (err) {
    console.error("[webhook/github] Error:", err);
    return c.json({ ok: false, error: "Internal error" }, 500);
  }
});

webhooksRouter.post("/gitlab", async (c) => {
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

    const verifiedTargets = matchingTargets.filter(
      ({ provider }) =>
        Boolean(provider.webhookSecret) && verifyGitLabToken(token, provider.webhookSecret!)
    );
    if (verifiedTargets.length === 0) {
      return c.json({ ok: false, error: "Invalid token" }, 401);
    }

    const gitlabEvent = (c.req.header("x-gitlab-event") ?? "").toLowerCase();
    const lifecycle = readGitLabPreviewLifecycle(
      payload as Parameters<typeof readGitLabPreviewLifecycle>[0]
    );
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

    const pushPayload = JSON.parse(rawBody) as GitLabPushEvent;
    const deliveryId = c.req.header("x-gitlab-event-uuid") ?? c.req.header("x-gitlab-webhook-uuid");
    const branch = (pushPayload.ref ?? "").replace("refs/heads/", "");
    const commitSha = pushPayload.checkout_sha ?? pushPayload.after ?? "";
    const changedPaths = collectChangedPaths(pushPayload.commits);
    const requestedByEmail = pushPayload.user_name ?? "gitlab-webhook";
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

    if (deliveryClaim.status === "duplicate") {
      return c.json({ ok: true, skipped: true, reason: "duplicate delivery" });
    }

    const response = await handlePushWebhook({
      providerType: "gitlab",
      repoFullName,
      branch,
      commitSha,
      changedPaths,
      deliveryId,
      deliveryKey: deliveryClaim.deliveryKey,
      requestedByEmail,
      matchingTargets: verifiedTargets
    });
    await finalizeWebhookDelivery({
      providerType: "gitlab",
      deliveryKey: deliveryClaim.deliveryKey,
      status: response.deliveryStatus,
      metadata: {
        repoFullName,
        branch,
        commitSha,
        deliveryId: deliveryId ?? null,
        deliveryKey: deliveryClaim.deliveryKey,
        deploymentCount: response.deployments,
        failedTargetCount: response.failedTargets,
        ignoredTargetCount: response.ignoredTargets,
        changedPaths
      }
    });

    return c.json({
      ok: response.ok,
      deployments: response.deployments,
      failedTargets: response.failedTargets,
      ignoredTargets: response.ignoredTargets,
      branch: response.branch,
      commit: response.commit
    });
  } catch (err) {
    console.error("[webhook/gitlab] Error:", err);
    return c.json({ ok: false, error: "Internal error" }, 500);
  }
});
