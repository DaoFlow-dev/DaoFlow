import { claimNextQueuedDevelopmentTask } from "../db/services/development-task-claims";
import { db } from "../db/connection";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { recordDevelopmentTaskEvent } from "../db/services/development-tasks";
import { eq } from "drizzle-orm";
import { upsertRunningGitHubDevelopmentTaskComment } from "../routes/github-issue-comments";

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
  return claimed;
}

type ClaimedDevelopmentTask = NonNullable<
  Awaited<ReturnType<typeof claimNextQueuedDevelopmentTask>>
>;

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
