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
import { gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { services } from "../db/schema/services";
import {
  beginWebhookDelivery,
  completeWebhookDelivery,
  findLatestPreviewDeploymentForService,
  listEligiblePreviewWebhookServices,
  recordPreviewWebhookLifecycleEvent
} from "../db/services/webhook-deliveries";
import { triggerDeploy } from "../db/services/trigger-deploy";
import { asRecord } from "../db/services/json-helpers";
import { readComposePreviewMetadata } from "../compose-preview";
import {
  buildWebhookDeliveryKey,
  readGitHubPreviewLifecycle,
  readGitLabPreviewLifecycle
} from "../webhook-preview-lifecycle";

type ProviderType = "github" | "gitlab";

interface GitHubPushEvent {
  ref?: string;
  after?: string;
  repository?: { full_name?: string };
  sender?: { login?: string };
}

interface GitLabPushEvent {
  ref?: string;
  after?: string;
  project?: { path_with_namespace?: string };
  user_name?: string;
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

  if (providerIds.length === 0) {
    return [];
  }

  const providerRows = await db
    .select()
    .from(gitProviders)
    .where(inArray(gitProviders.id, providerIds));
  const providerById = new Map(providerRows.map((provider) => [provider.id, provider]));

  return matchingProjects.flatMap((project) => {
    if (!project.gitProviderId) {
      return [];
    }

    const provider = providerById.get(project.gitProviderId);
    if (!provider || provider.type !== input.providerType) {
      return [];
    }

    return [{ project, provider }];
  });
}

async function triggerWebhookDeploys(input: {
  projectId: string;
  commitSha: string;
  requestedByEmail: string;
}) {
  const matchingServices = await db
    .select({ id: services.id })
    .from(services)
    .where(eq(services.projectId, input.projectId));

  const queuedDeployments = [];
  const failures: WebhookDeployFailure[] = [];
  for (const service of matchingServices) {
    const result = await triggerDeploy({
      serviceId: service.id,
      commitSha: input.commitSha,
      requestedByUserId: null,
      requestedByEmail: input.requestedByEmail,
      requestedByRole: "agent",
      trigger: "webhook"
    });

    if (result.status === "ok" && result.deployment) {
      queuedDeployments.push(result.deployment);
      continue;
    }

    failures.push({
      serviceId: service.id,
      status: result.status,
      entity: result.status === "not_found" ? result.entity : undefined,
      message:
        result.status === "invalid_source" || result.status === "provider_unavailable"
          ? result.message
          : undefined
    });
  }

  return {
    deployments: queuedDeployments,
    failures
  };
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
  requestedByEmail: string;
  matchingTargets: WebhookTarget[];
}) {
  const deployments = [];
  const failedTargets: WebhookDeployFailure[] = [];
  for (const { project } of input.matchingTargets) {
    const targetBranch = project.autoDeployBranch || project.defaultBranch || "main";
    if (input.branch !== targetBranch) {
      continue;
    }

    const projectResult = await triggerWebhookDeploys({
      projectId: project.id,
      commitSha: input.commitSha,
      requestedByEmail: input.requestedByEmail
    });
    deployments.push(...projectResult.deployments);
    failedTargets.push(...projectResult.failures);
  }

  if (failedTargets.length > 0) {
    console.warn(
      JSON.stringify({
        level: "warn",
        message: `${input.providerType} webhook auto-deploy skipped one or more targets`,
        repoFullName: input.repoFullName,
        branch: input.branch,
        commitSha: input.commitSha,
        failedTargets
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
    inputSummary: `Push to ${input.branch} (${summarizeCommit(input.commitSha)}) → ${deployments.length} deployments, ${failedTargets.length} failures`,
    permissionScope: "deploy:start",
    outcome: "success",
    metadata: {
      repoFullName: input.repoFullName,
      branch: input.branch,
      commitSha: input.commitSha,
      deploymentCount: deployments.length,
      failedTargetCount: failedTargets.length,
      failedTargets
    }
  });

  return {
    ok: true,
    deployments: deployments.length,
    failedTargets: failedTargets.length,
    branch: input.branch,
    commit: summarizeCommit(input.commitSha)
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

    const matchingTargets = await listWebhookTargets({
      repoFullName,
      providerType: "github"
    });
    if (matchingTargets.length === 0) {
      return c.json({ ok: true, skipped: true, reason: "no matching projects" });
    }

    const signatureValid = matchingTargets.some(
      ({ provider }) =>
        Boolean(provider.webhookSecret) &&
        verifyGitHubSignature(rawBody, signature, provider.webhookSecret!)
    );
    if (!signatureValid) {
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
          matchingTargets,
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
    return c.json(
      await handlePushWebhook({
        providerType: "github",
        repoFullName,
        branch: (pushPayload.ref ?? "").replace("refs/heads/", ""),
        commitSha: pushPayload.after ?? "",
        requestedByEmail: pushPayload.sender?.login ?? "github-webhook",
        matchingTargets
      })
    );
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

    const tokenValid = matchingTargets.some(
      ({ provider }) =>
        Boolean(provider.webhookSecret) && verifyGitLabToken(token, provider.webhookSecret!)
    );
    if (!tokenValid) {
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
          matchingTargets,
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
    return c.json(
      await handlePushWebhook({
        providerType: "gitlab",
        repoFullName,
        branch: (pushPayload.ref ?? "").replace("refs/heads/", ""),
        commitSha: pushPayload.after ?? "",
        requestedByEmail: pushPayload.user_name ?? "gitlab-webhook",
        matchingTargets
      })
    );
  } catch (err) {
    console.error("[webhook/gitlab] Error:", err);
    return c.json({ ok: false, error: "Internal error" }, 500);
  }
});
