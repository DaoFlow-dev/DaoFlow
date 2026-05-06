import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import { projects } from "../db/schema/projects";
import { recordDevelopmentTaskEvent } from "../db/services/development-tasks";
import { upsertFailedGitHubDevelopmentTaskComment } from "../routes/github-issue-comments";
import { upsertFailedGitLabDevelopmentTaskComment } from "../routes/gitlab-issue-comments";

async function loadCommentTarget(task: typeof developmentTasks.$inferSelect) {
  if (!task.providerInstallationId) {
    return null;
  }

  const [target] = await db
    .select({
      project: projects,
      provider: gitProviders,
      installation: gitInstallations
    })
    .from(projects)
    .innerJoin(gitInstallations, eq(gitInstallations.id, task.providerInstallationId))
    .innerJoin(gitProviders, eq(gitProviders.id, gitInstallations.providerId))
    .where(eq(projects.id, task.projectId))
    .limit(1);

  return target ?? null;
}

export async function updateDevelopmentTaskFailedStatusComment(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
}) {
  const target = await loadCommentTarget(input.task);
  if (!target) {
    return;
  }

  const updater =
    input.task.providerType === "gitlab"
      ? upsertFailedGitLabDevelopmentTaskComment
      : input.task.providerType === "github"
        ? upsertFailedGitHubDevelopmentTaskComment
        : null;
  if (!updater) {
    return;
  }

  await updater({
    task: input.task,
    run: input.run,
    target
  }).catch(async (err: unknown) => {
    await recordDevelopmentTaskEvent({
      taskId: input.task.id,
      runId: input.run.id,
      kind: "comment.failed",
      summary: `Failed to update the ${input.task.providerType} issue status comment after task failure.`,
      detail: err instanceof Error ? err.message : String(err),
      metadata: {
        providerType: input.task.providerType,
        repoFullName: input.task.repoFullName,
        issueNumber: input.task.issueNumber,
        status: "failed"
      }
    });
  });
}
