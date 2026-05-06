import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { readGitInstallationAccessToken } from "../db/services/git-providers";
import { buildGitLabApiBaseUrl } from "../db/services/project-source-provider-validation-shared";

function encodeProjectPath(repoFullName: string) {
  return encodeURIComponent(repoFullName);
}

async function writeGitLabIssueNote(input: {
  accessToken: string;
  url: string;
  method: "POST" | "PUT";
  body: string;
}) {
  const response = await fetch(input.url, {
    method: input.method,
    headers: {
      Accept: "application/json",
      Authorization: `Bearer ${input.accessToken}`,
      "Content-Type": "application/json",
      "User-Agent": "DaoFlow"
    },
    body: JSON.stringify({ body: input.body })
  });

  if (!response.ok) {
    throw new Error(`GitLab issue note write failed with status ${response.status}.`);
  }

  return (await response.json()) as { id?: number | string; web_url?: string; url?: string };
}

export async function sendGitLabIssueNote(input: {
  provider: typeof gitProviders.$inferSelect;
  installation: typeof gitInstallations.$inferSelect;
  repoFullName: string;
  issueNumber: number;
  body: string;
  existingCommentId?: string | null;
}) {
  const accessToken = readGitInstallationAccessToken(input.installation);
  if (!accessToken) {
    throw new Error("GitLab issue note requires an installation access token.");
  }

  const apiBaseUrl = buildGitLabApiBaseUrl(input.provider.baseUrl);
  const projectPath = encodeProjectPath(input.repoFullName);
  const createUrl = `${apiBaseUrl}/projects/${projectPath}/issues/${input.issueNumber}/notes`;
  const updateUrl = input.existingCommentId
    ? `${apiBaseUrl}/projects/${projectPath}/issues/${input.issueNumber}/notes/${encodeURIComponent(
        input.existingCommentId
      )}`
    : null;

  if (!updateUrl) {
    const comment = await writeGitLabIssueNote({
      accessToken,
      url: createUrl,
      method: "POST",
      body: input.body
    });
    return { comment, operation: "posted" as const };
  }

  try {
    const comment = await writeGitLabIssueNote({
      accessToken,
      url: updateUrl,
      method: "PUT",
      body: input.body
    });
    return { comment, operation: "updated" as const };
  } catch (error) {
    if (!(error instanceof Error) || !error.message.includes("status 404")) {
      throw error;
    }
  }

  const comment = await writeGitLabIssueNote({
    accessToken,
    url: createUrl,
    method: "POST",
    body: input.body
  });
  return { comment, operation: "reposted" as const };
}
