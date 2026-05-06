import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import type { projects } from "../db/schema/projects";
import { updateDevelopmentTaskRun } from "../db/services/development-tasks";
import {
  executeDevelopmentTaskCodex,
  type DevelopmentTaskCodexExecutionResult
} from "./development-task-codex-execution";
import type { DevelopmentTaskCodexPlan } from "./development-task-codex-plan";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import { createDevelopmentTaskLogEventStream } from "./development-task-log-events";
import {
  readDevelopmentTaskValidationCommands,
  runDevelopmentTaskValidation,
  type DevelopmentTaskValidationResult
} from "./development-task-validation";
import { openGitHubDevelopmentTaskPullRequest } from "./development-task-pull-request";
import { queueDevelopmentTaskPreviewDeployments } from "./development-task-preview";
import { completeDevelopmentTaskHandoff } from "./development-task-worker-handoff";
import type { DevelopmentTaskReviewTarget } from "./development-task-review-target";

let codexExecution = executeDevelopmentTaskCodex;
let validationExecution = runDevelopmentTaskValidation;
let pullRequestOpening = openGitHubDevelopmentTaskPullRequest;
let previewQueuing = queueDevelopmentTaskPreviewDeployments;

export async function runClaimedTaskCodex(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  project: typeof projects.$inferSelect;
  reviewTarget: DevelopmentTaskReviewTarget | null;
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

  const codexLogEvents = createDevelopmentTaskLogEventStream({
    taskId: input.task.id,
    runId: input.run.id,
    phase: "codex"
  });
  const execution = await codexExecution({
    plan: input.plan,
    workspace: input.workspace,
    onLog: (line) => {
      console.log(`[development-task-codex:${line.stream}] ${line.message}`);
      codexLogEvents.record(line);
    }
  }).catch((err: unknown): DevelopmentTaskCodexExecutionResult => {
    return {
      status: "failed",
      exitCode: 1,
      logPath: `${input.workspace.logsPath}/codex-exec.jsonl`,
      errorMessage: err instanceof Error ? err.message : String(err)
    };
  });
  await codexLogEvents.flush();

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

  const validationLogEvents = createDevelopmentTaskLogEventStream({
    taskId: input.task.id,
    runId: input.run.id,
    phase: "validation"
  });
  const validation = await validationExecution({
    workspace: input.workspace,
    commands: readDevelopmentTaskValidationCommands(input.metadata),
    onLog: (line) => {
      console.log(`[development-task-validation:${line.stream}] ${line.message}`);
      validationLogEvents.record(line);
    }
  }).catch((err: unknown): DevelopmentTaskValidationResult => {
    return {
      status: "failed",
      commands: readDevelopmentTaskValidationCommands(input.metadata),
      logPath: `${input.workspace.logsPath}/validation.jsonl`,
      errorMessage: err instanceof Error ? err.message : String(err)
    };
  });
  await validationLogEvents.flush();

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

  await completeDevelopmentTaskHandoff({
    task: input.task,
    run: input.run,
    project: input.project,
    reviewTarget: input.reviewTarget,
    workspace: input.workspace,
    metadata: input.metadata,
    codexExecution: execution,
    validation,
    pullRequestOpening,
    previewQueuing
  });
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
