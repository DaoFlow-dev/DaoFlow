import type { gitInstallations, gitProviders } from "../db/schema/git-providers";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import { resolveGitLabInstallationAccessToken } from "../db/services/gitlab-installation-auth";
import { buildGitLabApiBaseUrl } from "../db/services/project-source-provider-validation-shared";

function encodeProjectPath(repoFullName: string) {
  return encodeURIComponent(repoFullName);
}

function truncateTitle(value: string) {
  return value.length <= 180 ? value : `${value.slice(0, 177)}...`;
}

function buildMergeRequestBody(input: {
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

export async function createGitLabDevelopmentTaskMergeRequest(input: {
  provider: typeof gitProviders.$inferSelect;
  installation: typeof gitInstallations.$inferSelect;
  task: typeof developmentTasks.$inferSelect;
  run: typeof developmentTaskRuns.$inferSelect;
  branchName: string;
  validationStatus?: string;
}) {
  const accessToken = await resolveGitLabInstallationAccessToken({
    provider: input.provider,
    installation: input.installation
  });
  if (!accessToken) {
    throw new Error("GitLab installation does not have a usable access token.");
  }

  const response = await fetch(
    `${buildGitLabApiBaseUrl(input.provider.baseUrl)}/projects/${encodeProjectPath(
      input.task.repoFullName
    )}/merge_requests`,
    {
      method: "POST",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${accessToken}`,
        "Content-Type": "application/json",
        "User-Agent": "DaoFlow"
      },
      body: JSON.stringify({
        title: truncateTitle(`DaoFlow task: ${input.task.issueTitle}`),
        source_branch: input.branchName,
        target_branch: input.task.baseBranch,
        description: buildMergeRequestBody({
          task: input.task,
          run: input.run,
          validationStatus: input.validationStatus
        }),
        remove_source_branch: false
      })
    }
  );

  if (!response.ok) {
    throw new Error(`GitLab merge request creation failed with status ${response.status}.`);
  }

  const data = (await response.json()) as { iid?: number; web_url?: string };
  if (typeof data.iid !== "number" || !data.web_url) {
    throw new Error("GitLab merge request creation did not return an MR number and URL.");
  }

  return {
    pullRequestNumber: data.iid,
    pullRequestUrl: data.web_url
  };
}
