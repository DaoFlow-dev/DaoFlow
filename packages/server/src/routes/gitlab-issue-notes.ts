import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { resolveGitLabInstallationApiAccess } from "../db/services/gitlab-installation-auth";
import { fetchWithGitProviderCa } from "../db/services/git-provider-ca-trust";
import { resolveGitLabApiBaseUrl } from "../db/services/gitlab-urls";

function encodeProjectPath(repoFullName: string) {
  return encodeURIComponent(repoFullName);
}

async function writeGitLabIssueNote(input: {
  provider: Pick<typeof gitProviders.$inferSelect, "teamId" | "caCertificateId">;
  headers: Record<string, string>;
  url: string;
  method: "POST" | "PUT";
  body: string;
}) {
  const response = await fetchWithGitProviderCa(input.provider, input.url, {
    method: input.method,
    headers: {
      Accept: "application/json",
      "Content-Type": "application/json",
      "User-Agent": "DaoFlow",
      ...input.headers
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
  const apiAccess = await resolveGitLabInstallationApiAccess({
    provider: input.provider,
    installation: input.installation
  });
  if (apiAccess.status === "capability_unavailable") {
    throw new Error("GitLab deploy-token credentials cannot publish issue notes.");
  }
  if (apiAccess.status !== "ok") {
    throw new Error("GitLab issue note requires usable API credentials.");
  }

  const apiBaseUrl = resolveGitLabApiBaseUrl(input.provider);
  const projectPath = encodeProjectPath(input.repoFullName);
  const createUrl = `${apiBaseUrl}/projects/${projectPath}/issues/${input.issueNumber}/notes`;
  const updateUrl = input.existingCommentId
    ? `${apiBaseUrl}/projects/${projectPath}/issues/${input.issueNumber}/notes/${encodeURIComponent(
        input.existingCommentId
      )}`
    : null;

  if (!updateUrl) {
    const comment = await writeGitLabIssueNote({
      provider: input.provider,
      headers: apiAccess.headers,
      url: createUrl,
      method: "POST",
      body: input.body
    });
    return { comment, operation: "posted" as const };
  }

  try {
    const comment = await writeGitLabIssueNote({
      provider: input.provider,
      headers: apiAccess.headers,
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
    provider: input.provider,
    headers: apiAccess.headers,
    url: createUrl,
    method: "POST",
    body: input.body
  });
  return { comment, operation: "reposted" as const };
}
