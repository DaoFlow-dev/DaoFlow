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
import {
  recordDevelopmentTaskComment,
  recordDevelopmentTaskEvent
} from "../db/services/development-tasks";
import { buildGitHubApiBaseUrl } from "../db/services/project-source-provider-validation-shared";
import type { WebhookTarget } from "./webhooks-types";

type GitHubCommentTarget = Omit<WebhookTarget, "installation"> & {
  installation: typeof gitInstallations.$inferSelect;
};

function trimTrailingSlash(value: string) {
  return value.replace(/\/$/, "");
}

function resolveAppBaseUrl() {
  return trimTrailingSlash(
    process.env.APP_BASE_URL ?? process.env.BETTER_AUTH_URL ?? "http://localhost:3000"
  );
}

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

export function buildDevelopmentTaskQueuedComment(input: {
  taskId: string;
  repoFullName: string;
  issueNumber: number;
  projectName: string;
}) {
  const runUrl = buildDevelopmentTaskRunUrl(input.taskId);
  return [
    "DaoFlow accepted this task.",
    "",
    "Status: queued",
    `Run: ${runUrl}`,
    `Project: ${input.projectName}`,
    `Issue: ${input.repoFullName}#${input.issueNumber}`
  ].join("\n");
}

function buildDevelopmentTaskRunUrl(taskId: string) {
  return `${resolveAppBaseUrl()}/development-tasks/${taskId}`;
}

export function buildDevelopmentTaskRunningComment(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  projectName: string;
}) {
  const metadata = readMetadataRecord(input.run.metadata);
  const runner =
    typeof metadata.runnerLabel === "string"
      ? metadata.runnerLabel
      : (input.run.runnerId ?? "development-task-worker");
  const startedAt = input.run.startedAt?.toISOString() ?? new Date().toISOString();
  return [
    "DaoFlow started work.",
    "",
    "Status: running",
    `Runner: ${runner}`,
    `Started: ${startedAt}`,
    `Run: ${buildDevelopmentTaskRunUrl(input.task.id)}`,
    `Project: ${input.projectName}`,
    `Issue: ${input.task.repoFullName}#${input.task.issueNumber}`
  ].join("\n");
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
  accessToken: string;
  url: string;
  method: "PATCH" | "POST";
  body: string;
}) {
  const response = await fetch(input.url, {
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
      accessToken,
      url: createUrl,
      method: "POST",
      body: input.body
    });
    return { comment, operation: "posted" as const };
  }

  try {
    const comment = await writeGitHubIssueComment({
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
  if (!input.target.installation) {
    throw new Error("GitHub development task comment requires an installation.");
  }

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
    target: {
      project: input.target.project,
      provider: input.target.provider,
      installation: input.target.installation
    },
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
  if (!input.target.installation) {
    throw new Error("GitHub development task comment requires an installation.");
  }

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
    target: {
      project: input.target.project,
      provider: input.target.provider,
      installation: input.target.installation
    },
    status: "running",
    postedSummary: "Posted the running status comment on the GitHub issue.",
    updatedSummary: "Updated the status comment to show that work has started."
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
