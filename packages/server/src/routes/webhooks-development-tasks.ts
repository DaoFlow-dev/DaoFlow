import { claimWebhookDelivery, finalizeWebhookDelivery } from "../db/services/webhook-deliveries";
import {
  queueDevelopmentTask,
  recordDevelopmentTaskEvent,
  recordDevelopmentTaskComment
} from "../db/services/development-tasks";
import { upsertQueuedGitHubDevelopmentTaskComment } from "./github-issue-comments";
import {
  authorizeGitHubDevelopmentTaskActor,
  type DevelopmentTaskActorAuthorization
} from "./development-task-trigger-authorization";
import { buildTargetResource, writeWebhookAuditEntry } from "./webhooks-delivery";
import type { GitHubPushEvent, WebhookTarget } from "./webhooks-types";

export { listDevelopmentTaskWebhookTargets } from "./webhooks-development-task-targets";

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
  const issueBody = typeof issue.body === "string" ? issue.body : null;

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
  let unauthorized = 0;
  const actorLogin =
    input.trigger.kind === "comment"
      ? input.payload.comment?.user?.login
      : input.payload.sender?.login;

  for (const target of input.matchingTargets) {
    const authorization: DevelopmentTaskActorAuthorization =
      await authorizeGitHubDevelopmentTaskActor({
        target,
        repoFullName: input.repoFullName,
        actorLogin
      }).catch((err: unknown) => ({
        ok: false,
        reason: err instanceof Error ? err.message : String(err)
      }));

    if (!authorization.ok) {
      unauthorized += 1;
      await writeWebhookAuditEntry({
        providerType: "github",
        repoFullName: input.repoFullName,
        actorId: actorLogin ?? "github-webhook",
        actorEmail: actorLogin ?? "github-webhook",
        action: "development_task.webhook.denied",
        inputSummary: `Denied GitHub development task trigger for ${input.repoFullName}#${issueNumber}`,
        outcome: "denied",
        metadata: {
          deliveryKey: deliveryClaim.deliveryKey,
          issueNumber,
          trigger: input.trigger.kind,
          actorLogin: actorLogin ?? null,
          projectId: target.project.id,
          reason: authorization.reason ?? "unauthorized",
          permission: authorization.permission ?? null
        }
      });
      continue;
    }

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
        issueBody,
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
    status:
      queued > 0 ? "queued" : deduped > 0 ? "deduped" : unauthorized > 0 ? "rejected" : "ignored",
    metadata: {
      repoFullName: input.repoFullName,
      issueNumber,
      queued,
      deduped,
      unauthorized,
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
      unauthorized,
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
