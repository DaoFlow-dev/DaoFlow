import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { gitInstallations } from "../db/schema/git-providers";
import {
  developmentTaskComments,
  developmentTaskRuns,
  developmentTasks
} from "../db/schema/development-tasks";
import {
  recordDevelopmentTaskComment,
  recordDevelopmentTaskEvent
} from "../db/services/development-tasks";
import type { WebhookTarget } from "./webhooks-types";
import {
  buildDevelopmentTaskFailedComment,
  buildDevelopmentTaskQueuedComment,
  buildDevelopmentTaskReadyForReviewComment,
  buildDevelopmentTaskRunningComment
} from "./github-issue-comment-bodies";
import { sendGitLabIssueNote } from "./gitlab-issue-notes";

export type GitLabCommentTarget = Omit<WebhookTarget, "installation"> & {
  installation: typeof gitInstallations.$inferSelect;
};

const statusCommentLocks = new Map<string, Promise<void>>();

async function withStatusCommentLock<T>(taskId: string, operation: () => Promise<T>): Promise<T> {
  const previous = statusCommentLocks.get(taskId) ?? Promise.resolve();
  let release!: () => void;
  const current = previous.then(
    () =>
      new Promise<void>((resolve) => {
        release = resolve;
      })
  );
  statusCommentLocks.set(taskId, current);
  await previous;

  try {
    return await operation();
  } finally {
    release();
    if (statusCommentLocks.get(taskId) === current) {
      statusCommentLocks.delete(taskId);
    }
  }
}

function hashBody(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

function readMetadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

async function findStatusComment(taskId: string) {
  const [comment] = await db
    .select()
    .from(developmentTaskComments)
    .where(
      and(
        eq(developmentTaskComments.taskId, taskId),
        eq(developmentTaskComments.providerType, "gitlab"),
        eq(developmentTaskComments.commentKind, "status")
      )
    )
    .limit(1);

  return comment ?? null;
}

async function deleteStatusCommentRecord(commentId: string) {
  await db.delete(developmentTaskComments).where(eq(developmentTaskComments.id, commentId));
}

export async function upsertQueuedGitLabDevelopmentTaskComment(input: {
  taskId: string;
  repoFullName: string;
  issueNumber: number;
  target: WebhookTarget;
}) {
  await upsertGitLabDevelopmentTaskStatusComment({
    taskId: input.taskId,
    body: buildDevelopmentTaskQueuedComment({
      taskId: input.taskId,
      repoFullName: input.repoFullName,
      issueNumber: input.issueNumber,
      projectName: input.target.project.name
    }),
    repoFullName: input.repoFullName,
    issueNumber: input.issueNumber,
    target: requireGitLabCommentTarget(input.target),
    status: "queued",
    postedSummary: "Posted the queued status note on the GitLab issue.",
    updatedSummary: "Updated the queued status note on the GitLab issue."
  });
}

export async function upsertRunningGitLabDevelopmentTaskComment(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  target: WebhookTarget;
}) {
  await upsertGitLabDevelopmentTaskStatusComment({
    taskId: input.task.id,
    runId: input.run.id,
    body: buildDevelopmentTaskRunningComment({
      task: input.task,
      run: input.run,
      projectName: input.target.project.name
    }),
    repoFullName: input.task.repoFullName,
    issueNumber: input.task.issueNumber,
    target: requireGitLabCommentTarget(input.target),
    status: "running",
    postedSummary: "Posted the running status note on the GitLab issue.",
    updatedSummary: "Updated the status note to show that work has started."
  });
}

export async function upsertReadyForReviewGitLabDevelopmentTaskComment(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  target: WebhookTarget;
}) {
  await upsertGitLabDevelopmentTaskStatusComment({
    taskId: input.task.id,
    runId: input.run.id,
    body: buildDevelopmentTaskReadyForReviewComment({
      task: input.task,
      run: input.run,
      projectName: input.target.project.name,
      reviewRequestLabel: "Merge request",
      openedSummary: "DaoFlow opened a merge request."
    }),
    repoFullName: input.task.repoFullName,
    issueNumber: input.task.issueNumber,
    target: requireGitLabCommentTarget(input.target),
    status: "waiting_review",
    postedSummary: "Posted the merge request status note on the GitLab issue.",
    updatedSummary: "Updated the status note with the merge request handoff."
  });
}

export async function upsertFailedGitLabDevelopmentTaskComment(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  target: WebhookTarget;
}) {
  await upsertGitLabDevelopmentTaskStatusComment({
    taskId: input.task.id,
    runId: input.run.id,
    body: buildDevelopmentTaskFailedComment({
      task: input.task,
      run: input.run,
      projectName: input.target.project.name
    }),
    repoFullName: input.task.repoFullName,
    issueNumber: input.task.issueNumber,
    target: requireGitLabCommentTarget(input.target),
    status: "failed",
    postedSummary: "Posted the failed status note on the GitLab issue.",
    updatedSummary: "Updated the status note with the failure reason."
  });
}

function requireGitLabCommentTarget(target: WebhookTarget): GitLabCommentTarget {
  if (!target.installation) {
    throw new Error("GitLab development task note requires an installation.");
  }

  return {
    project: target.project,
    provider: target.provider,
    installation: target.installation
  };
}

async function upsertGitLabDevelopmentTaskStatusComment(input: {
  taskId: string;
  runId?: string | null;
  body: string;
  repoFullName: string;
  issueNumber: number;
  target: GitLabCommentTarget;
  status: string;
  postedSummary: string;
  updatedSummary: string;
}) {
  return withStatusCommentLock(input.taskId, () =>
    upsertGitLabDevelopmentTaskStatusCommentLocked(input)
  );
}

async function upsertGitLabDevelopmentTaskStatusCommentLocked(input: {
  taskId: string;
  runId?: string | null;
  body: string;
  repoFullName: string;
  issueNumber: number;
  target: GitLabCommentTarget;
  status: string;
  postedSummary: string;
  updatedSummary: string;
}) {
  const existingComment = await findStatusComment(input.taskId);
  const written = await sendGitLabIssueNote({
    provider: input.target.provider,
    installation: input.target.installation,
    repoFullName: input.repoFullName,
    issueNumber: input.issueNumber,
    body: input.body,
    existingCommentId: existingComment?.externalCommentId ?? null
  });
  const externalCommentId = String(written.comment.id ?? existingComment?.externalCommentId ?? "");
  if (!externalCommentId) {
    throw new Error("GitLab issue note write did not return a note id.");
  }
  if (existingComment && existingComment.externalCommentId !== externalCommentId) {
    await deleteStatusCommentRecord(existingComment.id);
  }
  const existingMetadata = readMetadataRecord(existingComment?.metadata);
  const commentUrl =
    written.comment.web_url ??
    written.comment.url ??
    (typeof existingMetadata.commentUrl === "string" ? existingMetadata.commentUrl : null);

  await recordDevelopmentTaskComment({
    taskId: input.taskId,
    runId: input.runId ?? null,
    providerType: "gitlab",
    externalCommentId,
    commentKind: "status",
    lastBodyHash: hashBody(input.body),
    metadata: {
      commentUrl,
      status: input.status
    }
  });

  await recordDevelopmentTaskEvent({
    taskId: input.taskId,
    runId: input.runId ?? null,
    kind: written.operation === "updated" ? "comment.updated" : "comment.posted",
    summary: written.operation === "updated" ? input.updatedSummary : input.postedSummary,
    metadata: {
      providerType: "gitlab",
      externalCommentId,
      commentUrl,
      status: input.status
    }
  });
}
