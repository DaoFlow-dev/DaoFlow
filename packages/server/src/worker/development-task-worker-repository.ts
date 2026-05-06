import type { projects } from "../db/schema/projects";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import {
  recordDevelopmentTaskEvent,
  updateDevelopmentTaskRun
} from "../db/services/development-tasks";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import {
  checkoutDevelopmentTaskRepository,
  type DevelopmentTaskRepositoryCheckoutResult
} from "./development-task-repository-checkout";
import { updateDevelopmentTaskFailedStatusComment } from "./development-task-worker-comments";

let repositoryCheckout = checkoutDevelopmentTaskRepository;

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

export async function prepareClaimedTaskRepository(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  project: typeof projects.$inferSelect;
}): Promise<DevelopmentTaskRepositoryCheckoutResult> {
  await recordDevelopmentTaskEvent({
    taskId: input.task.id,
    runId: input.run.id,
    kind: "repository.checkout.started",
    summary: "Started checking out the development task repository.",
    metadata: {
      repoFullName: input.task.repoFullName,
      branch: input.task.baseBranch,
      repoPath: input.workspace.repoPath
    }
  });

  const checkout = await repositoryCheckout({
    task: input.task,
    run: input.run,
    project: input.project,
    repoPath: input.workspace.repoPath,
    artifactsPath: input.workspace.artifactsPath,
    onLog: (line) => {
      console.log(`[development-task-worker:${line.stream}] ${line.message}`);
    }
  }).catch((err: unknown): DevelopmentTaskRepositoryCheckoutResult => {
    return {
      status: "failed",
      repoPath: input.workspace.repoPath,
      errorMessage: err instanceof Error ? err.message : String(err)
    };
  });

  if (checkout.status !== "ok") {
    const failedRun = await updateDevelopmentTaskRun({
      runId: input.run.id,
      status: "failed",
      failureCategory: "repository_checkout_failed",
      failureMessage: checkout.errorMessage ?? "Repository checkout failed.",
      metadata: {
        ...readRecord(input.run.metadata),
        codexWorkspace: input.workspace,
        repositoryCheckout: checkout
      }
    });
    if (failedRun) {
      await updateDevelopmentTaskFailedStatusComment({ task: input.task, run: failedRun });
    }
    return checkout;
  }

  await recordDevelopmentTaskEvent({
    taskId: input.task.id,
    runId: input.run.id,
    kind: "repository.checkout.completed",
    summary: "Checked out the development task repository.",
    metadata: {
      repoFullName: checkout.displayLabel ?? input.task.repoFullName,
      branch: checkout.branch ?? input.task.baseBranch,
      repoPath: checkout.repoPath
    }
  });

  return checkout;
}

export function setDevelopmentTaskRepositoryCheckoutForTests(
  next: typeof checkoutDevelopmentTaskRepository
) {
  repositoryCheckout = next;
}

export function resetDevelopmentTaskRepositoryCheckoutForTests() {
  repositoryCheckout = checkoutDevelopmentTaskRepository;
}
