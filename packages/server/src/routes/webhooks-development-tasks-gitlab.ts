import { claimWebhookDelivery, finalizeWebhookDelivery } from "../db/services/webhook-deliveries";
import {
  queueDevelopmentTask,
  recordDevelopmentTaskComment,
  recordDevelopmentTaskEvent
} from "../db/services/development-tasks";
import {
  authorizeGitLabDevelopmentTaskActor,
  type DevelopmentTaskActorAuthorization
} from "./development-task-trigger-authorization";
import { upsertQueuedGitLabDevelopmentTaskComment } from "./gitlab-issue-comments";
import { buildTargetResource, writeWebhookAuditEntry } from "./webhooks-delivery";
import type { GitLabPushEvent, WebhookTarget } from "./webhooks-types";

const GITLAB_RUN_LABEL = "daoflow:run";
const GITLAB_RUN_COMMAND = /(^|\n)\s*\/daoflow\s+run(?:\s|$)/i;

type GitLabDevelopmentTaskTrigger =
  { kind: "label"; externalCommentId?: never } | { kind: "comment"; externalCommentId: string };

function readLabelName(label: { title?: string; name?: string }) {
  return (label.title ?? label.name ?? "").trim().toLowerCase();
}

function hasRunLabel(labels: { title?: string; name?: string }[] | undefined) {
  return labels?.some((label) => readLabelName(label) === GITLAB_RUN_LABEL) === true;
}

function issueActionCanTrigger(payload: GitLabPushEvent) {
  const action = payload.object_attributes?.action ?? payload.action;
  if (action === "open" || action === "reopen") {
    return true;
  }

  return action === "update" && Boolean(payload.changes?.labels);
}

function readIssueUrl(payload: GitLabPushEvent, issueNumber: number) {
  return (
    payload.issue?.web_url ??
    payload.issue?.url ??
    payload.object_attributes?.url ??
    (payload.project?.web_url ? `${payload.project.web_url}/-/issues/${issueNumber}` : null)
  );
}

function readIssue(payload: GitLabPushEvent) {
  const isNote = payload.object_kind === "note" || payload.event_type === "note";
  const issueNumber = isNote ? payload.issue?.iid : payload.object_attributes?.iid;
  const issueId = isNote ? payload.issue?.id : payload.object_attributes?.id;
  const issueTitle = isNote ? payload.issue?.title : payload.object_attributes?.title;

  if (!issueNumber || !issueId || !issueTitle) {
    return null;
  }

  const issueUrl = readIssueUrl(payload, issueNumber);
  if (!issueUrl) {
    return null;
  }

  return {
    id: String(issueId),
    number: issueNumber,
    url: issueUrl,
    title: issueTitle,
    body: payload.issue?.description ?? payload.object_attributes?.description ?? null,
    author: payload.issue?.author?.username ?? null,
    labels: payload.issue?.labels ?? payload.object_attributes?.labels ?? payload.labels
  };
}

export function readGitLabDevelopmentTaskTrigger(
  eventHeader: string,
  payload: GitLabPushEvent
): GitLabDevelopmentTaskTrigger | null {
  const event = eventHeader.toLowerCase();
  const issue = readIssue(payload);
  if (!issue) {
    return null;
  }

  if (event.includes("issue") || payload.object_kind === "issue") {
    return issueActionCanTrigger(payload) && hasRunLabel(issue.labels) ? { kind: "label" } : null;
  }

  if (event.includes("note") || payload.object_kind === "note") {
    const attrs = payload.object_attributes;
    const isIssueNote = attrs?.noteable_type?.toLowerCase() === "issue" || Boolean(payload.issue);
    if (!isIssueNote || attrs?.action === "update" || !attrs?.id) {
      return null;
    }

    return GITLAB_RUN_COMMAND.test(attrs.note ?? "")
      ? { kind: "comment", externalCommentId: String(attrs.id) }
      : null;
  }

  return null;
}

export async function processGitLabDevelopmentTaskTrigger(input: {
  event: string;
  rawBody: string;
  deliveryId?: string | null;
  payload: GitLabPushEvent;
  repoFullName: string;
  matchingTargets: WebhookTarget[];
  trigger: GitLabDevelopmentTaskTrigger;
}) {
  const issue = readIssue(input.payload);
  if (!issue) {
    return { ok: true, skipped: true, reason: "unsupported issue payload" };
  }

  const deliveryClaim = await claimWebhookDelivery({
    providerType: "gitlab",
    eventType: input.event,
    rawBody: input.rawBody,
    deliveryId: input.deliveryId,
    repoFullName: input.repoFullName,
    metadata: {
      repoFullName: input.repoFullName,
      issueNumber: issue.number,
      trigger: input.trigger.kind
    }
  });

  if (deliveryClaim.status === "duplicate") {
    await writeWebhookAuditEntry({
      providerType: "gitlab",
      repoFullName: input.repoFullName,
      actorId: "gitlab-webhook",
      actorEmail: input.payload.user_username ?? input.payload.user_name ?? "gitlab-webhook",
      action: "development_task.webhook.duplicate",
      inputSummary: `Ignored duplicate GitLab development task trigger for ${input.repoFullName}#${issue.number}`,
      outcome: "success",
      metadata: {
        deliveryKey: deliveryClaim.deliveryKey,
        issueNumber: issue.number,
        trigger: input.trigger.kind
      }
    });
    return { ok: true, skipped: true, reason: "duplicate delivery" };
  }

  let queued = 0;
  let deduped = 0;
  let unauthorized = 0;
  const actorUsername =
    input.payload.user?.username ?? input.payload.user_username ?? input.payload.user_name;

  for (const target of input.matchingTargets) {
    const authorization: DevelopmentTaskActorAuthorization =
      await authorizeGitLabDevelopmentTaskActor({
        target,
        repoFullName: input.repoFullName,
        actorUsername
      }).catch((err: unknown) => ({
        ok: false,
        reason: err instanceof Error ? err.message : String(err)
      }));

    if (!authorization.ok) {
      unauthorized += 1;
      await writeWebhookAuditEntry({
        providerType: "gitlab",
        repoFullName: input.repoFullName,
        actorId: actorUsername ?? "gitlab-webhook",
        actorEmail: actorUsername ?? "gitlab-webhook",
        action: "development_task.webhook.denied",
        inputSummary: `Denied GitLab development task trigger for ${input.repoFullName}#${issue.number}`,
        outcome: "denied",
        metadata: {
          deliveryKey: deliveryClaim.deliveryKey,
          issueNumber: issue.number,
          trigger: input.trigger.kind,
          actorUsername: actorUsername ?? null,
          projectId: target.project.id,
          reason: authorization.reason ?? "unauthorized",
          permission: authorization.permission ?? null
        }
      });
      continue;
    }

    const result = await queueDevelopmentTask({
      providerType: "gitlab",
      providerInstallationId: target.installation?.id ?? null,
      projectId: target.project.id,
      repoFullName: input.repoFullName,
      externalIssueId: issue.id,
      issueNumber: issue.number,
      issueUrl: issue.url,
      issueTitle: issue.title,
      issueAuthor: issue.author,
      baseBranch: target.project.defaultBranch ?? "main",
      requestedByExternalUser:
        input.payload.user_username ?? input.payload.user?.username ?? input.payload.user_name,
      metadata: {
        trigger: input.trigger.kind,
        deliveryKey: deliveryClaim.deliveryKey,
        issueBody: issue.body,
        targetResource: buildTargetResource("gitlab", input.repoFullName)
      }
    });

    if (result.status === "created") {
      queued += 1;
      await upsertQueuedGitLabDevelopmentTaskComment({
        taskId: result.task.id,
        repoFullName: input.repoFullName,
        issueNumber: issue.number,
        target
      }).catch(async (err: unknown) => {
        await recordDevelopmentTaskEvent({
          taskId: result.task.id,
          kind: "comment.failed",
          summary: "Failed to post the queued status note on the GitLab issue.",
          detail: err instanceof Error ? err.message : String(err),
          metadata: {
            providerType: "gitlab",
            issueNumber: issue.number,
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
        providerType: "gitlab",
        externalCommentId: input.trigger.externalCommentId,
        commentKind: "trigger",
        metadata: {
          deliveryKey: deliveryClaim.deliveryKey,
          commentUrl: input.payload.object_attributes?.url ?? null
        }
      });
    }
  }

  await finalizeWebhookDelivery({
    providerType: "gitlab",
    deliveryKey: deliveryClaim.deliveryKey,
    status:
      queued > 0 ? "queued" : deduped > 0 ? "deduped" : unauthorized > 0 ? "rejected" : "ignored",
    metadata: {
      repoFullName: input.repoFullName,
      issueNumber: issue.number,
      queued,
      deduped,
      unauthorized,
      trigger: input.trigger.kind
    }
  });

  await writeWebhookAuditEntry({
    providerType: "gitlab",
    repoFullName: input.repoFullName,
    actorId: "gitlab-webhook",
    actorEmail: input.payload.user_username ?? input.payload.user_name ?? "gitlab-webhook",
    action: queued > 0 ? "development_task.webhook.queue" : "development_task.webhook.dedupe",
    inputSummary:
      queued > 0
        ? `Queued ${queued} development task(s) for ${input.repoFullName}#${issue.number}`
        : `Deduped development task trigger for ${input.repoFullName}#${issue.number}`,
    outcome: "success",
    metadata: {
      deliveryKey: deliveryClaim.deliveryKey,
      issueNumber: issue.number,
      queued,
      deduped,
      unauthorized,
      trigger: input.trigger.kind
    }
  });

  return {
    ok: true,
    tasksQueued: queued,
    duplicateTasks: deduped,
    issueNumber: issue.number,
    trigger: input.trigger.kind
  };
}
