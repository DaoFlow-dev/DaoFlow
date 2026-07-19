import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../db/connection";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import {
  developmentTaskComments,
  developmentTaskRuns,
  developmentTasks
} from "../db/schema/development-tasks";
import { fetchGitHubInstallationAccessToken } from "../db/services/github-app-auth";
import { fetchWithGitProviderCa } from "../db/services/git-provider-ca-trust";
import {
  recordDevelopmentTaskComment,
  recordDevelopmentTaskEvent
} from "../db/services/development-tasks";
import { buildGitHubApiBaseUrl } from "../db/services/project-source-provider-validation-shared";
import type { WebhookTarget } from "./webhooks-types";
import {
  buildDevelopmentTaskFailedComment,
  buildDevelopmentTaskQueuedComment,
  buildDevelopmentTaskReadyForReviewComment,
  buildDevelopmentTaskRunningComment
} from "./github-issue-comment-bodies";

export type GitHubCommentTarget = Omit<WebhookTarget, "installation"> & {
  installation: typeof gitInstallations.$inferSelect;
};

function encodeRepoPath(repoFullName: string) {
  return repoFullName
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function hashBody(body: string) {
  return createHash("sha256").update(body).digest("hex");
}

function readMetadataRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function toGitHubCommentTarget(target: WebhookTarget): GitHubCommentTarget {
  if (!target.installation) {
    throw new Error("GitHub development task comment requires an installation.");
  }

  return {
    project: target.project,
    provider: target.provider,
    installation: target.installation
  };
}

async function findStatusComment(taskId: string) {
  const [comment] = await db
    .select()
    .from(developmentTaskComments)
    .where(
      and(
        eq(developmentTaskComments.taskId, taskId),
        eq(developmentTaskComments.providerType, "github"),
        eq(developmentTaskComments.commentKind, "status")
      )
    )
    .limit(1);

  return comment ?? null;
}

async function deleteStatusCommentRecord(commentId: string) {
  await db.delete(developmentTaskComments).where(eq(developmentTaskComments.id, commentId));
}

async function writeGitHubIssueComment(input: {
  provider: Pick<typeof gitProviders.$inferSelect, "teamId" | "caCertificateId">;
  accessToken: string;
  url: string;
  method: "PATCH" | "POST";
  body: string;
}) {
  const response = await fetchWithGitProviderCa(input.provider, input.url, {
    method: input.method,
    headers: {
      Accept: "application/vnd.github+json",
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "DaoFlow"
    },
    body: JSON.stringify({ body: input.body })
  });

  if (!response.ok) {
    throw new Error(`GitHub issue comment write failed with status ${response.status}.`);
  }

  return (await response.json()) as { id?: number | string; html_url?: string };
}

async function sendGitHubIssueComment(input: {
  provider: typeof gitProviders.$inferSelect;
  installation: typeof gitInstallations.$inferSelect;
  repoFullName: string;
  issueNumber: number;
  body: string;
  existingCommentId?: string | null;
}) {
  const accessToken = await fetchGitHubInstallationAccessToken({
    provider: input.provider,
    installation: input.installation
  });
  const apiBaseUrl = buildGitHubApiBaseUrl(input.provider.baseUrl);
  const repoPath = encodeRepoPath(input.repoFullName);
  const createUrl = `${apiBaseUrl}/repos/${repoPath}/issues/${input.issueNumber}/comments`;
  const updateUrl = input.existingCommentId
    ? `${apiBaseUrl}/repos/${repoPath}/issues/comments/${encodeURIComponent(input.existingCommentId)}`
    : null;

  if (!updateUrl) {
    const comment = await writeGitHubIssueComment({
      provider: input.provider,
      accessToken,
      url: createUrl,
      method: "POST",
      body: input.body
    });
    return { comment, operation: "posted" as const };
  }

  try {
    const comment = await writeGitHubIssueComment({
      provider: input.provider,
      accessToken,
      url: updateUrl,
      method: "PATCH",
      body: input.body
    });
    return { comment, operation: "updated" as const };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("status 404")) {
      throw error;
    }
  }

  const comment = await writeGitHubIssueComment({
    provider: input.provider,
    accessToken,
    url: createUrl,
    method: "POST",
    body: input.body
  });
  return { comment, operation: "reposted" as const };
}

export async function upsertQueuedGitHubDevelopmentTaskComment(input: {
  taskId: string;
  repoFullName: string;
  issueNumber: number;
  target: WebhookTarget;
}) {
  await upsertGitHubDevelopmentTaskStatusComment({
    taskId: input.taskId,
    body: buildDevelopmentTaskQueuedComment({
      taskId: input.taskId,
      repoFullName: input.repoFullName,
      issueNumber: input.issueNumber,
      projectName: input.target.project.name
    }),
    repoFullName: input.repoFullName,
    issueNumber: input.issueNumber,
    target: toGitHubCommentTarget(input.target),
    status: "queued",
    postedSummary: "Posted the queued status comment on the GitHub issue.",
    updatedSummary: "Updated the queued status comment on the GitHub issue."
  });
}

export async function upsertRunningGitHubDevelopmentTaskComment(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  target: WebhookTarget;
}) {
  await upsertGitHubDevelopmentTaskStatusComment({
    taskId: input.task.id,
    runId: input.run.id,
    body: buildDevelopmentTaskRunningComment({
      task: input.task,
      run: input.run,
      projectName: input.target.project.name
    }),
    repoFullName: input.task.repoFullName,
    issueNumber: input.task.issueNumber,
    target: toGitHubCommentTarget(input.target),
    status: "running",
    postedSummary: "Posted the running status comment on the GitHub issue.",
    updatedSummary: "Updated the status comment to show that work has started."
  });
}

export async function upsertReadyForReviewGitHubDevelopmentTaskComment(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  target: WebhookTarget;
}) {
  await upsertGitHubDevelopmentTaskStatusComment({
    taskId: input.task.id,
    runId: input.run.id,
    body: buildDevelopmentTaskReadyForReviewComment({
      task: input.task,
      run: input.run,
      projectName: input.target.project.name
    }),
    repoFullName: input.task.repoFullName,
    issueNumber: input.task.issueNumber,
    target: toGitHubCommentTarget(input.target),
    status: "waiting_review",
    postedSummary: "Posted the pull request status comment on the GitHub issue.",
    updatedSummary: "Updated the status comment with the pull request handoff."
  });
}

export async function upsertFailedGitHubDevelopmentTaskComment(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  target: WebhookTarget;
}) {
  await upsertGitHubDevelopmentTaskStatusComment({
    taskId: input.task.id,
    runId: input.run.id,
    body: buildDevelopmentTaskFailedComment({
      task: input.task,
      run: input.run,
      projectName: input.target.project.name
    }),
    repoFullName: input.task.repoFullName,
    issueNumber: input.task.issueNumber,
    target: toGitHubCommentTarget(input.target),
    status: "failed",
    postedSummary: "Posted the failed status comment on the GitHub issue.",
    updatedSummary: "Updated the status comment with the failure reason."
  });
}

async function upsertGitHubDevelopmentTaskStatusComment(input: {
  taskId: string;
  runId?: string | null;
  body: string;
  repoFullName: string;
  issueNumber: number;
  target: GitHubCommentTarget;
  status: string;
  postedSummary: string;
  updatedSummary: string;
}) {
  const existingComment = await findStatusComment(input.taskId);
  const written = await sendGitHubIssueComment({
    provider: input.target.provider,
    installation: input.target.installation,
    repoFullName: input.repoFullName,
    issueNumber: input.issueNumber,
    body: input.body,
    existingCommentId: existingComment?.externalCommentId ?? null
  });
  const externalCommentId = String(written.comment.id ?? existingComment?.externalCommentId ?? "");
  if (!externalCommentId) {
    throw new Error("GitHub issue comment write did not return a comment id.");
  }
  if (existingComment && existingComment.externalCommentId !== externalCommentId) {
    await deleteStatusCommentRecord(existingComment.id);
  }
  const existingMetadata = readMetadataRecord(existingComment?.metadata);
  const commentUrl =
    written.comment.html_url ??
    (typeof existingMetadata.commentUrl === "string" ? existingMetadata.commentUrl : null);

  await recordDevelopmentTaskComment({
    taskId: input.taskId,
    runId: input.runId ?? null,
    providerType: "github",
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
      providerType: "github",
      externalCommentId,
      commentUrl,
      status: input.status
    }
  });
}
