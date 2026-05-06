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
import {
  executeDevelopmentTaskCodex,
  type DevelopmentTaskCodexExecutionResult
} from "./development-task-codex-execution";
import type { DevelopmentTaskCodexPlan } from "./development-task-codex-plan";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import {
  readDevelopmentTaskValidationCommands,
  runDevelopmentTaskValidation,
  type DevelopmentTaskValidationResult
} from "./development-task-validation";
import {
  openGitHubDevelopmentTaskPullRequest,
  type DevelopmentTaskPullRequestResult
} from "./development-task-pull-request";
import { queueDevelopmentTaskPreviewDeployments } from "./development-task-preview";

let codexExecution = executeDevelopmentTaskCodex;
let validationExecution = runDevelopmentTaskValidation;
let pullRequestOpening = openGitHubDevelopmentTaskPullRequest;
let previewQueuing = queueDevelopmentTaskPreviewDeployments;
const NO_PREVIEW_FIELDS = { previewDeploymentId: undefined, previewUrl: undefined };

export async function runClaimedTaskCodex(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  project: typeof projects.$inferSelect;
  githubTarget: GitHubCommentTarget | null;
  plan: DevelopmentTaskCodexPlan;
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  metadata: Record<string, unknown>;
}) {
  await updateDevelopmentTaskRun({
    runId: input.run.id,
    status: "coding",
    metadata: {
      ...input.metadata,
      codexExecution: {
        status: "started",
        logPath: `${input.workspace.logsPath}/codex-exec.jsonl`
      }
    }
  });

  const execution = await codexExecution({
    plan: input.plan,
    workspace: input.workspace,
    onLog: (line) => {
      console.log(`[development-task-codex:${line.stream}] ${line.message}`);
    }
  }).catch((err: unknown): DevelopmentTaskCodexExecutionResult => {
    return {
      status: "failed",
      exitCode: 1,
      logPath: `${input.workspace.logsPath}/codex-exec.jsonl`,
      errorMessage: err instanceof Error ? err.message : String(err)
    };
  });

  if (execution.status !== "ok") {
    await updateDevelopmentTaskRun({
      runId: input.run.id,
      status: "failed",
      failureCategory: "codex_execution_failed",
      failureMessage: execution.errorMessage ?? "Codex execution failed.",
      metadata: {
        ...input.metadata,
        codexExecution: execution
      }
    });
    return;
  }

  await updateDevelopmentTaskRun({
    runId: input.run.id,
    status: "validating",
    metadata: {
      ...input.metadata,
      codexExecution: execution,
      validation: {
        status: "started",
        logPath: `${input.workspace.logsPath}/validation.jsonl`
      }
    }
  });

  const validation = await validationExecution({
    workspace: input.workspace,
    commands: readDevelopmentTaskValidationCommands(input.metadata),
    onLog: (line) => {
      console.log(`[development-task-validation:${line.stream}] ${line.message}`);
    }
  }).catch((err: unknown): DevelopmentTaskValidationResult => {
    return {
      status: "failed",
      commands: readDevelopmentTaskValidationCommands(input.metadata),
      logPath: `${input.workspace.logsPath}/validation.jsonl`,
      errorMessage: err instanceof Error ? err.message : String(err)
    };
  });

  if (validation.status === "failed") {
    await updateDevelopmentTaskRun({
      runId: input.run.id,
      status: "failed",
      failureCategory: "validation_failed",
      failureMessage: validation.errorMessage ?? "Development task validation failed.",
      metadata: {
        ...input.metadata,
        codexExecution: execution,
        validation
      }
    });
    return;
  }

  await updateDevelopmentTaskRun({
    runId: input.run.id,
    status: "opening_pr",
    metadata: {
      ...input.metadata,
      codexExecution: execution,
      validation,
      pullRequest: {
        status: "started",
        logPath: `${input.workspace.logsPath}/pull-request.jsonl`
      }
    }
  });

  if (!input.githubTarget) {
    await updateDevelopmentTaskRun({
      runId: input.run.id,
      status: "failed",
      failureCategory: "pull_request_failed",
      failureMessage: "GitHub target is not available for pull request creation.",
      metadata: {
        ...input.metadata,
        codexExecution: execution,
        validation,
        pullRequest: {
          status: "failed",
          logPath: `${input.workspace.logsPath}/pull-request.jsonl`,
          errorMessage: "GitHub target is not available for pull request creation."
        }
      }
    });
    return;
  }

  const pullRequest = await pullRequestOpening({
    task: input.task,
    run: input.run,
    project: input.project,
    provider: input.githubTarget.provider,
    installation: input.githubTarget.installation,
    workspace: input.workspace,
    validationStatus: validation.status,
    onLog: (line) => {
      console.log(`[development-task-pr:${line.stream}] ${line.message}`);
    }
  }).catch((err: unknown): DevelopmentTaskPullRequestResult => {
    return {
      status: "failed",
      logPath: `${input.workspace.logsPath}/pull-request.jsonl`,
      errorMessage: err instanceof Error ? err.message : String(err)
    };
  });

  if (pullRequest.status !== "ok") {
    await updateDevelopmentTaskRun({
      runId: input.run.id,
      status: "failed",
      failureCategory: "pull_request_failed",
      failureMessage: pullRequest.errorMessage ?? "Pull request creation failed.",
      metadata: {
        ...input.metadata,
        codexExecution: execution,
        validation,
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
      codexExecution: execution,
      validation,
      pullRequest
    }
  });
  const preview = previewRun
    ? await previewQueuing({ task: input.task, run: previewRun }).catch((err: unknown) => ({
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
      codexExecution: execution,
      validation,
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

export function setDevelopmentTaskCodexExecutionForTests(next: typeof executeDevelopmentTaskCodex) {
  codexExecution = next;
}

export function resetDevelopmentTaskCodexExecutionForTests() {
  codexExecution = executeDevelopmentTaskCodex;
}

export function setDevelopmentTaskValidationExecutionForTests(next: typeof validationExecution) {
  validationExecution = next;
}

export function resetDevelopmentTaskValidationExecutionForTests() {
  validationExecution = runDevelopmentTaskValidation;
}

export function setDevelopmentTaskPullRequestOpeningForTests(next: typeof pullRequestOpening) {
  pullRequestOpening = next;
}

export function resetDevelopmentTaskPullRequestOpeningForTests() {
  pullRequestOpening = openGitHubDevelopmentTaskPullRequest;
}

export function setDevelopmentTaskPreviewQueuingForTests(next: typeof previewQueuing) {
  previewQueuing = next;
}

export function resetDevelopmentTaskPreviewQueuingForTests() {
  previewQueuing = queueDevelopmentTaskPreviewDeployments;
}
