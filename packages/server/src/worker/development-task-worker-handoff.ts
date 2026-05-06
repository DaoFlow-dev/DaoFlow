import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import type { projects } from "../db/schema/projects";
import {
  recordDevelopmentTaskEvent,
  updateDevelopmentTaskRun
} from "../db/services/development-tasks";
import {
  upsertReadyForReviewGitHubDevelopmentTaskComment,
  type GitHubCommentTarget
} from "../routes/github-issue-comments";
import type { DevelopmentTaskValidationResult } from "./development-task-validation";
import type { DevelopmentTaskCodexExecutionResult } from "./development-task-codex-execution";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import {
  recordPreviewHandoffAudit,
  recordPullRequestHandoffAudit
} from "./development-task-handoff-audit";
import type {
  openGitHubDevelopmentTaskPullRequest,
  DevelopmentTaskPullRequestResult
} from "./development-task-pull-request";
import type { queueDevelopmentTaskPreviewDeployments } from "./development-task-preview";

const NO_PREVIEW_FIELDS = { previewDeploymentId: undefined, previewUrl: undefined };

async function recordPullRequestAuditSafely(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  project: typeof projects.$inferSelect;
  pullRequest: DevelopmentTaskPullRequestResult;
}) {
  await recordPullRequestHandoffAudit(input).catch((err: unknown) => {
    console.error(
      "[development-task-worker] Failed to record pull request handoff audit:",
      err instanceof Error ? err.message : String(err)
    );
  });
}

async function recordPreviewAuditSafely(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  project: typeof projects.$inferSelect;
  preview: Awaited<ReturnType<typeof queueDevelopmentTaskPreviewDeployments>>;
}) {
  await recordPreviewHandoffAudit(input).catch((err: unknown) => {
    console.error(
      "[development-task-worker] Failed to record preview handoff audit:",
      err instanceof Error ? err.message : String(err)
    );
  });
}

export async function completeDevelopmentTaskHandoff(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  project: typeof projects.$inferSelect;
  githubTarget: GitHubCommentTarget | null;
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  metadata: Record<string, unknown>;
  codexExecution: DevelopmentTaskCodexExecutionResult;
  validation: DevelopmentTaskValidationResult;
  pullRequestOpening: typeof openGitHubDevelopmentTaskPullRequest;
  previewQueuing: typeof queueDevelopmentTaskPreviewDeployments;
}) {
  await updateDevelopmentTaskRun({
    runId: input.run.id,
    status: "opening_pr",
    metadata: {
      ...input.metadata,
      codexExecution: input.codexExecution,
      validation: input.validation,
      pullRequest: {
        status: "started",
        logPath: `${input.workspace.logsPath}/pull-request.jsonl`
      }
    }
  });

  const missingTarget = "GitHub target is not available for pull request creation.";
  if (!input.githubTarget) {
    const pullRequest = {
      status: "failed" as const,
      logPath: `${input.workspace.logsPath}/pull-request.jsonl`,
      errorMessage: missingTarget
    };
    await recordPullRequestAuditSafely({
      task: input.task,
      run: input.run,
      project: input.project,
      pullRequest
    });
    await updateDevelopmentTaskRun({
      runId: input.run.id,
      status: "failed",
      failureCategory: "pull_request_failed",
      failureMessage: missingTarget,
      metadata: {
        ...input.metadata,
        codexExecution: input.codexExecution,
        validation: input.validation,
        pullRequest
      }
    });
    return;
  }

  const pullRequest = await input
    .pullRequestOpening({
      task: input.task,
      run: input.run,
      project: input.project,
      provider: input.githubTarget.provider,
      installation: input.githubTarget.installation,
      workspace: input.workspace,
      validationStatus: input.validation.status,
      onLog: (line) => {
        console.log(`[development-task-pr:${line.stream}] ${line.message}`);
      }
    })
    .catch((err: unknown): DevelopmentTaskPullRequestResult => {
      return {
        status: "failed",
        logPath: `${input.workspace.logsPath}/pull-request.jsonl`,
        errorMessage: err instanceof Error ? err.message : String(err)
      };
    });

  await recordPullRequestAuditSafely({
    task: input.task,
    run: input.run,
    project: input.project,
    pullRequest
  });
  if (pullRequest.status !== "ok") {
    await updateDevelopmentTaskRun({
      runId: input.run.id,
      status: "failed",
      failureCategory: "pull_request_failed",
      failureMessage: pullRequest.errorMessage ?? "Pull request creation failed.",
      metadata: {
        ...input.metadata,
        codexExecution: input.codexExecution,
        validation: input.validation,
        pullRequest
      }
    });
    return;
  }

  const previewRun = await updateDevelopmentTaskRun({
    runId: input.run.id,
    status: "deploying_preview",
    branchName: pullRequest.branchName,
    commitSha: pullRequest.commitSha,
    pullRequestNumber: pullRequest.pullRequestNumber,
    pullRequestUrl: pullRequest.pullRequestUrl,
    metadata: {
      ...input.metadata,
      codexExecution: input.codexExecution,
      validation: input.validation,
      pullRequest
    }
  });
  const preview = previewRun
    ? await input.previewQueuing({ task: input.task, run: previewRun }).catch((err: unknown) => ({
        status: "failed" as const,
        deployments: [],
        ...NO_PREVIEW_FIELDS,
        message: err instanceof Error ? err.message : String(err)
      }))
    : {
        status: "skipped" as const,
        deployments: [],
        ...NO_PREVIEW_FIELDS,
        message: "Run update failed before preview deployment."
      };
  await recordPreviewAuditSafely({
    task: input.task,
    run: previewRun ?? input.run,
    project: input.project,
    preview
  });

  const waitingRun = await updateDevelopmentTaskRun({
    runId: input.run.id,
    status: "waiting_review",
    branchName: pullRequest.branchName,
    commitSha: pullRequest.commitSha,
    pullRequestNumber: pullRequest.pullRequestNumber,
    pullRequestUrl: pullRequest.pullRequestUrl,
    previewDeploymentId: preview.previewDeploymentId,
    previewUrl: preview.previewUrl,
    metadata: {
      ...input.metadata,
      codexExecution: input.codexExecution,
      validation: input.validation,
      pullRequest,
      preview
    }
  });

  if (waitingRun) {
    await upsertReadyForReviewGitHubDevelopmentTaskComment({
      task: input.task,
      run: waitingRun,
      target: input.githubTarget
    }).catch(async (err: unknown) => {
      await recordDevelopmentTaskEvent({
        taskId: input.task.id,
        runId: input.run.id,
        kind: "comment.failed",
        summary: "Failed to update the GitHub issue status comment with the pull request.",
        detail: err instanceof Error ? err.message : String(err),
        metadata: {
          providerType: "github",
          repoFullName: input.task.repoFullName,
          issueNumber: input.task.issueNumber,
          status: "waiting_review",
          pullRequestUrl: pullRequest.pullRequestUrl ?? null
        }
      });
    });
  }
}
