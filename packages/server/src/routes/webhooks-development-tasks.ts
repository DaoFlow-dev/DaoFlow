import { and, eq, inArray } from "drizzle-orm";
import { db } from "../db/connection";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import {
  claimWebhookDelivery,
  finalizeWebhookDelivery,
  type WebhookDeliveryProviderType
} from "../db/services/webhook-deliveries";
import {
  queueDevelopmentTask,
  recordDevelopmentTaskEvent,
  recordDevelopmentTaskComment
} from "../db/services/development-tasks";
import { upsertQueuedGitHubDevelopmentTaskComment } from "./github-issue-comments";
import { buildTargetResource, writeWebhookAuditEntry } from "./webhooks-delivery";
import type { GitHubPushEvent, WebhookTarget } from "./webhooks-types";

const GITHUB_RUN_LABEL = "daoflow:run";
const GITHUB_RUN_COMMAND = /(^|\n)\s*\/daoflow\s+run(?:\s|$)/i;

type DevelopmentTaskTrigger =
  | { kind: "label"; externalCommentId?: never }
  | { kind: "comment"; externalCommentId: string };

function readIssue(payload: GitHubPushEvent) {
  const issue = payload.issue;
  if (!issue || issue.pull_request) {
    return null;
  }

  if (!issue.id || !issue.number || !issue.html_url || !issue.title) {
    return null;
  }

  return issue;
}

export function readGitHubDevelopmentTaskTrigger(
  event: string,
  payload: GitHubPushEvent
): DevelopmentTaskTrigger | null {
  const issue = readIssue(payload);
  if (!issue) {
    return null;
  }

  if (event === "issues" && payload.action === "labeled") {
    const labelName = payload.label?.name?.trim().toLowerCase();
    const hasRunLabel =
      labelName === GITHUB_RUN_LABEL ||
      issue.labels?.some((label) => label.name?.trim().toLowerCase() === GITHUB_RUN_LABEL) === true;
    return hasRunLabel ? { kind: "label" } : null;
  }

  if (event === "issue_comment" && payload.action === "created") {
    const comment = payload.comment;
    if (!comment?.id || !GITHUB_RUN_COMMAND.test(comment.body ?? "")) {
      return null;
    }
    return { kind: "comment", externalCommentId: String(comment.id) };
  }

  return null;
}

export async function listDevelopmentTaskWebhookTargets(input: {
  repoFullName: string;
  providerType: WebhookDeliveryProviderType;
  externalInstallationId?: string | null;
}): Promise<WebhookTarget[]> {
  const matchingProjects = await db
    .select()
    .from(projects)
    .where(and(eq(projects.repoFullName, input.repoFullName), eq(projects.status, "active")));

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
    if (!provider || provider.type !== input.providerType || provider.status !== "active") {
      return [];
    }

    const installation = project.gitInstallationId
      ? (installationById.get(project.gitInstallationId) ?? null)
      : null;

    if (!installation || installation.status !== "active") {
      return [];
    }

    if (
      input.externalInstallationId &&
      installation.installationId !== input.externalInstallationId
    ) {
      return [];
    }

    return [{ project, provider, installation }];
  });
}

export async function processGitHubDevelopmentTaskTrigger(input: {
  event: string;
  rawBody: string;
  deliveryId?: string | null;
  payload: GitHubPushEvent;
  repoFullName: string;
  externalInstallationId?: string | null;
  matchingTargets: WebhookTarget[];
  trigger: DevelopmentTaskTrigger;
}) {
  const issue = readIssue(input.payload);
  if (!issue) {
    return { ok: true, skipped: true, reason: "unsupported issue payload" };
  }
  const issueId = String(issue.id);
  const issueNumber = Number(issue.number);
  const issueUrl = String(issue.html_url);
  const issueTitle = String(issue.title);

  const deliveryClaim = await claimWebhookDelivery({
    providerType: "github",
    eventType: input.event,
    rawBody: input.rawBody,
    deliveryId: input.deliveryId,
    repoFullName: input.repoFullName,
    externalInstallationId: input.externalInstallationId,
    metadata: {
      repoFullName: input.repoFullName,
      issueNumber,
      trigger: input.trigger.kind
    }
  });

  if (deliveryClaim.status === "duplicate") {
    await writeWebhookAuditEntry({
      providerType: "github",
      repoFullName: input.repoFullName,
      actorId: "github-webhook",
      actorEmail: input.payload.sender?.login ?? "github-webhook",
      action: "development_task.webhook.duplicate",
      inputSummary: `Ignored duplicate GitHub development task trigger for ${input.repoFullName}#${issueNumber}`,
      outcome: "success",
      metadata: {
        deliveryKey: deliveryClaim.deliveryKey,
        issueNumber,
        trigger: input.trigger.kind
      }
    });
    return { ok: true, skipped: true, reason: "duplicate delivery" };
  }

  let queued = 0;
  let deduped = 0;

  for (const target of input.matchingTargets) {
    const result = await queueDevelopmentTask({
      providerType: "github",
      providerInstallationId: target.installation?.id ?? null,
      projectId: target.project.id,
      repoFullName: input.repoFullName,
      externalIssueId: issueId,
      issueNumber,
      issueUrl,
      issueTitle,
      issueAuthor: issue.user?.login ?? null,
      baseBranch: target.project.defaultBranch ?? "main",
      requestedByExternalUser:
        input.payload.comment?.user?.login ?? input.payload.sender?.login ?? issue.user?.login,
      metadata: {
        trigger: input.trigger.kind,
        deliveryKey: deliveryClaim.deliveryKey,
        targetResource: buildTargetResource("github", input.repoFullName)
      }
    });

    if (result.status === "created") {
      queued += 1;
      await upsertQueuedGitHubDevelopmentTaskComment({
        taskId: result.task.id,
        repoFullName: input.repoFullName,
        issueNumber,
        target
      }).catch(async (err: unknown) => {
        await recordDevelopmentTaskEvent({
          taskId: result.task.id,
          kind: "comment.failed",
          summary: "Failed to post the queued status comment on the GitHub issue.",
          detail: err instanceof Error ? err.message : String(err),
          metadata: {
            providerType: "github",
            issueNumber,
            status: "queued"
          }
        });
      });
    } else {
      deduped += 1;
    }

    if (input.trigger.kind === "comment" && result.task) {
      await recordDevelopmentTaskComment({
        taskId: result.task.id,
        providerType: "github",
        externalCommentId: input.trigger.externalCommentId,
        commentKind: "trigger",
        metadata: {
          deliveryKey: deliveryClaim.deliveryKey,
          commentUrl: input.payload.comment?.html_url ?? null
        }
      });
    }
  }

  await finalizeWebhookDelivery({
    providerType: "github",
    deliveryKey: deliveryClaim.deliveryKey,
    status: queued > 0 ? "queued" : deduped > 0 ? "deduped" : "ignored",
    metadata: {
      repoFullName: input.repoFullName,
      issueNumber,
      queued,
      deduped,
      trigger: input.trigger.kind
    }
  });

  await writeWebhookAuditEntry({
    providerType: "github",
    repoFullName: input.repoFullName,
    actorId: "github-webhook",
    actorEmail: input.payload.sender?.login ?? "github-webhook",
    action: queued > 0 ? "development_task.webhook.queue" : "development_task.webhook.dedupe",
    inputSummary:
      queued > 0
        ? `Queued ${queued} development task(s) for ${input.repoFullName}#${issueNumber}`
        : `Deduped development task trigger for ${input.repoFullName}#${issueNumber}`,
    outcome: "success",
    metadata: {
      deliveryKey: deliveryClaim.deliveryKey,
      issueNumber,
      queued,
      deduped,
      trigger: input.trigger.kind
    }
  });

  return {
    ok: true,
    tasksQueued: queued,
    duplicateTasks: deduped,
    issueNumber,
    trigger: input.trigger.kind
  };
}
