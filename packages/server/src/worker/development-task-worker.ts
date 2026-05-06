import { claimNextQueuedDevelopmentTask } from "../db/services/development-task-claims";
import { db } from "../db/connection";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import {
  recordDevelopmentTaskEvent,
  updateDevelopmentTaskRun
} from "../db/services/development-tasks";
import { eq } from "drizzle-orm";
import { upsertRunningGitHubDevelopmentTaskComment } from "../routes/github-issue-comments";
import { buildDevelopmentTaskCodexPlan } from "./development-task-codex-plan";
import { prepareDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import { runClaimedTaskCodex } from "./development-task-worker-codex";
import { prepareClaimedTaskRepository } from "./development-task-worker-repository";

const DEVELOPMENT_TASK_POLL_INTERVAL_MS = 10_000;
let running = false;

export async function pollDevelopmentTaskQueue() {
  const claimed = await claimNextQueuedDevelopmentTask({
    runnerId: "development-task-worker",
    runnerLabel: "development-task-worker"
  });

  if (!claimed) {
    return null;
  }

  console.log(
    `[development-task-worker] Claimed task ${claimed.task.id} with run ${claimed.run.id}`
  );
  await updateClaimedTaskStatusComment(claimed);
  await prepareClaimedTaskWorkspace(claimed);
  return claimed;
}

type ClaimedDevelopmentTask = NonNullable<
  Awaited<ReturnType<typeof claimNextQueuedDevelopmentTask>>
>;

function readRecord(value: unknown) {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function developmentTaskWorkspaceRoot() {
  return process.env.DAOFLOW_DEVELOPMENT_TASK_WORKSPACE_ROOT ?? "/runner/work";
}

async function loadGitHubCommentTarget(claimed: ClaimedDevelopmentTask) {
  if (claimed.task.providerType !== "github" || !claimed.task.providerInstallationId) {
    return null;
  }

  const [target] = await db
    .select({
      project: projects,
      provider: gitProviders,
      installation: gitInstallations
    })
    .from(projects)
    .innerJoin(gitInstallations, eq(gitInstallations.id, claimed.task.providerInstallationId))
    .innerJoin(gitProviders, eq(gitProviders.id, gitInstallations.providerId))
    .where(eq(projects.id, claimed.task.projectId))
    .limit(1);

  return target ?? null;
}

async function loadDevelopmentTaskProject(claimed: ClaimedDevelopmentTask) {
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, claimed.task.projectId))
    .limit(1);

  return project ?? null;
}

async function updateClaimedTaskStatusComment(claimed: ClaimedDevelopmentTask) {
  const target = await loadGitHubCommentTarget(claimed);
  if (!target) {
    return;
  }

  await upsertRunningGitHubDevelopmentTaskComment({
    task: claimed.task,
    run: claimed.run,
    target
  }).catch(async (err: unknown) => {
    await recordDevelopmentTaskEvent({
      taskId: claimed.task.id,
      runId: claimed.run.id,
      kind: "comment.failed",
      summary: "Failed to update the GitHub issue status comment after claiming the task.",
      detail: err instanceof Error ? err.message : String(err),
      metadata: {
        providerType: "github",
        repoFullName: claimed.task.repoFullName,
        issueNumber: claimed.task.issueNumber,
        status: "running"
      }
    });
  });
}

async function prepareClaimedTaskWorkspace(claimed: ClaimedDevelopmentTask) {
  if (claimed.run.sandboxProvider !== "host_docker") {
    await updateDevelopmentTaskRun({
      runId: claimed.run.id,
      status: "failed",
      failureCategory: "unsupported_sandbox_provider",
      failureMessage: `Development task worker does not yet support sandbox provider ${claimed.run.sandboxProvider ?? "unknown"}.`,
      metadata: {
        ...readRecord(claimed.run.metadata),
        unsupportedSandboxProvider: claimed.run.sandboxProvider ?? null
      }
    });
    return;
  }

  try {
    const plan = buildDevelopmentTaskCodexPlan({
      task: claimed.task,
      run: claimed.run,
      workspaceRoot: developmentTaskWorkspaceRoot()
    });
    const workspace = await prepareDevelopmentTaskCodexWorkspace(plan);
    const project = await loadDevelopmentTaskProject(claimed);

    if (!project) {
      throw new Error(`Project ${claimed.task.projectId} was not found for development task.`);
    }

    const checkout = await prepareClaimedTaskRepository({
      task: claimed.task,
      run: claimed.run,
      workspace,
      project
    });
    if (checkout.status !== "ok") {
      return;
    }
    const metadata = readRecord(claimed.run.metadata);
    const nextMetadata = {
      ...metadata,
      codexWorkspace: workspace,
      repositoryCheckout: checkout,
      codexCommand: {
        command: plan.command,
        args: plan.args.map((arg) => (arg === plan.prompt ? `@${workspace.promptPath}` : arg))
      }
    };

    await updateDevelopmentTaskRun({
      runId: claimed.run.id,
      status: "preparing",
      metadata: nextMetadata
    });
    await runClaimedTaskCodex({
      task: claimed.task,
      run: claimed.run,
      plan,
      workspace,
      metadata: nextMetadata
    });
  } catch (err) {
    await updateDevelopmentTaskRun({
      runId: claimed.run.id,
      status: "failed",
      failureCategory: "workspace_prepare_failed",
      failureMessage: err instanceof Error ? err.message : String(err),
      metadata: {
        ...readRecord(claimed.run.metadata),
        workspacePrepareFailed: true
      }
    });
  }
}

export function startDevelopmentTaskWorker(): void {
  if (running) {
    console.warn("[development-task-worker] Worker already running, skipping duplicate start");
    return;
  }

  running = true;
  console.log(
    `[development-task-worker] Worker started (poll interval: ${DEVELOPMENT_TASK_POLL_INTERVAL_MS}ms)`
  );

  const poll = async () => {
    while (running) {
      try {
        await pollDevelopmentTaskQueue();
      } catch (err) {
        console.error(
          "[development-task-worker] Unhandled error in poll loop:",
          err instanceof Error ? err.message : String(err)
        );
      }
      await new Promise((resolve) => setTimeout(resolve, DEVELOPMENT_TASK_POLL_INTERVAL_MS));
    }
  };

  void poll();
}

export function stopDevelopmentTaskWorker(): void {
  running = false;
  console.log("[development-task-worker] Worker stopping");
}

export {
  resetDevelopmentTaskCodexExecutionForTests,
  resetDevelopmentTaskValidationExecutionForTests,
  setDevelopmentTaskCodexExecutionForTests,
  setDevelopmentTaskValidationExecutionForTests
} from "./development-task-worker-codex";

export {
  resetDevelopmentTaskRepositoryCheckoutForTests,
  setDevelopmentTaskRepositoryCheckoutForTests
} from "./development-task-worker-repository";
