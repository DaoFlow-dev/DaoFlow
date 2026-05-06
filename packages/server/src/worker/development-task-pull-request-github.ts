import type { gitInstallations, gitProviders } from "../db/schema/git-providers";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import { fetchGitHubInstallationAccessToken } from "../db/services/github-app-auth";
import { buildGitHubApiBaseUrl } from "../db/services/project-source-provider-validation-shared";

function encodeRepoPath(repoFullName: string) {
  return repoFullName
    .split("/")
    .map((part) => encodeURIComponent(part))
    .join("/");
}

function safeBranchSegment(value: string) {
  return value
    .toLowerCase()
    .replace(/[^a-z0-9._-]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
}

export function buildDevelopmentTaskBranchName(
  task: typeof developmentTasks.$inferSelect,
  runId: string
) {
  const title = safeBranchSegment(task.issueTitle) || "task";
  return `daoflow/issue-${task.issueNumber}-${runId.slice(0, 8)}-${title}`.slice(0, 150);
}

function truncateTitle(value: string) {
  return value.length <= 180 ? value : `${value.slice(0, 177)}...`;
}

function buildPullRequestBody(input: {
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  validationStatus?: string;
}) {
  return [
    `DaoFlow development task for ${input.task.issueUrl}`,
    "",
    `Run: ${input.run.id}`,
    `Validation: ${input.validationStatus ?? "completed"}`,
    "",
    "Preview: pending"
  ].join("\n");
}

export async function createGitHubDevelopmentTaskPullRequest(input: {
  provider: typeof gitProviders.$inferSelect;
  installation: typeof gitInstallations.$inferSelect;
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  branchName: string;
  validationStatus?: string;
}) {
  const accessToken = await fetchGitHubInstallationAccessToken({
    provider: input.provider,
    installation: input.installation
  });
  const response = await fetch(
    `${buildGitHubApiBaseUrl(input.provider.baseUrl)}/repos/${encodeRepoPath(input.task.repoFullName)}/pulls`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "DaoFlow"
      },
      body: JSON.stringify({
        title: truncateTitle(`DaoFlow task: ${input.task.issueTitle}`),
        head: input.branchName,
        base: input.task.baseBranch,
        body: buildPullRequestBody({
          task: input.task,
          run: input.run,
          validationStatus: input.validationStatus
        })
      })
    }
  );

  if (!response.ok) {
    throw new Error(`GitHub pull request creation failed with status ${response.status}.`);
  }

  const data = (await response.json()) as { number?: number; html_url?: string };
  if (typeof data.number !== "number" || !data.html_url) {
    throw new Error("GitHub pull request creation did not return a PR number and URL.");
  }

  return {
    pullRequestNumber: data.number,
    pullRequestUrl: data.html_url
  };
}
