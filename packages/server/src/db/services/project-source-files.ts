import { readFileSync } from "node:fs";
import { createSign } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "../connection";
import { gitProviders } from "../schema/git-providers";
import { decrypt } from "../crypto";
import { getGitInstallation } from "./git-providers";
import { fetchWithGitProviderCa } from "./git-provider-ca-trust";
import { resolveGitLabInstallationApiAccess } from "./gitlab-installation-auth";
import { resolveGitLabApiBaseUrl } from "./gitlab-urls";
import { asRecord } from "./json-helpers";
import { materializeProjectSourceInspection } from "./project-source-checkout-inspection";
import { resolveProjectSourceWorkspaceFile } from "./project-source-workspace-files";

type ProjectSourceFileProject = {
  id?: string;
  teamId: string;
  repoUrl: string | null;
  repoFullName: string | null;
  gitProviderId: string | null;
  gitInstallationId: string | null;
  config?: unknown;
};

type ProjectSourceFileResult =
  | { status: "ok"; content: string }
  | { status: "not_found"; reason: string }
  | { status: "not_available"; reason: string };

const PROJECT_SOURCE_FILE_TIMEOUT_MS = 10_000;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/$/, "");
}

function toBase64(value: string): string {
  return Buffer.from(value, "utf8").toString("base64");
}

function toBase64Url(value: string): string {
  return toBase64(value).replace(/=/g, "").replace(/\+/g, "-").replace(/\//g, "_");
}

function encodeGitHubRepoPath(repoFullName: string): string {
  return repoFullName
    .split("/")
    .map((segment) => encodeURIComponent(segment))
    .join("/");
}

function buildGitHubApiBaseUrl(baseUrl: string | null): string {
  if (!baseUrl) {
    return "https://api.github.com";
  }

  const normalized = trimTrailingSlash(baseUrl);
  return normalized.includes("/api/") ? normalized : `${normalized}/api/v3`;
}

function createGitHubAppJwt(appId: string, privateKeyPem: string): string {
  const nowSeconds = Math.floor(Date.now() / 1000);
  const header = toBase64Url(JSON.stringify({ alg: "RS256", typ: "JWT" }));
  const payload = toBase64Url(
    JSON.stringify({
      iat: nowSeconds - 60,
      exp: nowSeconds + 600,
      iss: appId
    })
  );
  const signingInput = `${header}.${payload}`;
  const signer = createSign("RSA-SHA256");
  signer.update(signingInput);
  signer.end();
  const signature = signer
    .sign(privateKeyPem, "base64")
    .replace(/=/g, "")
    .replace(/\+/g, "-")
    .replace(/\//g, "_");

  return `${signingInput}.${signature}`;
}

async function fetchWithTimeout(
  provider: Pick<typeof gitProviders.$inferSelect, "teamId" | "caCertificateId">,
  url: string,
  init: RequestInit
): Promise<Response> {
  return fetchWithGitProviderCa(provider, url, {
    ...init,
    signal: AbortSignal.timeout(PROJECT_SOURCE_FILE_TIMEOUT_MS)
  });
}

async function fetchGitHubInstallationToken(input: {
  provider: Pick<
    typeof gitProviders.$inferSelect,
    "appId" | "baseUrl" | "name" | "privateKeyEncrypted" | "teamId" | "caCertificateId"
  >;
  installationId: string;
}): Promise<{ status: "ok"; token: string } | { status: "not_available"; reason: string }> {
  if (!input.provider.appId || !input.provider.privateKeyEncrypted) {
    return {
      status: "not_available",
      reason: `GitHub provider ${input.provider.name} is missing app credentials.`
    };
  }

  const jwt = createGitHubAppJwt(input.provider.appId, decrypt(input.provider.privateKeyEncrypted));
  const response = await fetchWithTimeout(
    input.provider,
    `${buildGitHubApiBaseUrl(input.provider.baseUrl)}/app/installations/${input.installationId}/access_tokens`,
    {
      method: "POST",
      headers: {
        Accept: "application/vnd.github+json",
        Authorization: `Bearer ${jwt}`,
        "User-Agent": "DaoFlow"
      }
    }
  ).catch((error: unknown) => {
    throw new Error(error instanceof Error ? error.message : String(error));
  });

  if (!response.ok) {
    return {
      status: "not_available",
      reason: `GitHub installation token exchange failed with status ${response.status}.`
    };
  }

  const payload = (await response.json()) as { token?: string };
  if (!payload.token) {
    return {
      status: "not_available",
      reason: "GitHub installation token exchange did not return a token."
    };
  }

  return { status: "ok", token: payload.token };
}

async function readMaterializedProjectSourceFile(input: {
  project: ProjectSourceFileProject;
  branch: string;
  path: string;
}): Promise<ProjectSourceFileResult> {
  const inspection = await materializeProjectSourceInspection({
    project: {
      id: input.project.id,
      teamId: input.project.teamId,
      repoUrl: input.project.repoUrl,
      repoFullName: input.project.repoFullName,
      gitProviderId: input.project.gitProviderId,
      gitInstallationId: input.project.gitInstallationId,
      repositoryPreparation: asRecord(asRecord(input.project.config).repositoryPreparation)
    },
    branch: input.branch
  });

  if (inspection.status !== "ok") return inspection;

  try {
    const file = resolveProjectSourceWorkspaceFile(inspection.workDir, input.path);
    if (file.status === "unsafe") {
      return {
        status: "not_found",
        reason: `Repository file path ${input.path} escapes the repository.`
      };
    }
    if (file.status === "missing") {
      return {
        status: "not_found",
        reason: `Repository file ${input.path} was not found in ${input.project.repoFullName ?? input.project.repoUrl}@${input.branch}.`
      };
    }
    return { status: "ok", content: readFileSync(file.path, "utf8") };
  } finally {
    inspection.cleanup();
  }
}

export async function fetchProjectRepositoryTextFile(input: {
  project: ProjectSourceFileProject;
  branch: string;
  path: string;
}): Promise<ProjectSourceFileResult> {
  if (input.project.repoUrl && !input.project.gitProviderId && !input.project.gitInstallationId) {
    return readMaterializedProjectSourceFile(input);
  }

  if (
    !input.project.repoFullName ||
    !input.project.gitProviderId ||
    !input.project.gitInstallationId
  ) {
    return {
      status: "not_available",
      reason:
        "Project source does not define a supported provider-linked repository or a generic repoUrl checkout."
    };
  }

  const [provider, installation] = await Promise.all([
    db
      .select()
      .from(gitProviders)
      .where(
        and(
          eq(gitProviders.id, input.project.gitProviderId),
          eq(gitProviders.teamId, input.project.teamId)
        )
      )
      .limit(1),
    getGitInstallation(input.project.gitInstallationId, input.project.teamId)
  ]);
  const providerRow = provider[0];

  if (!providerRow) {
    return {
      status: "not_available",
      reason: `Git provider ${input.project.gitProviderId} was not found.`
    };
  }

  if (
    !installation ||
    installation.providerId !== input.project.gitProviderId ||
    installation.teamId !== input.project.teamId
  ) {
    return {
      status: "not_available",
      reason: `Git installation ${input.project.gitInstallationId} was not found for provider ${input.project.gitProviderId}.`
    };
  }

  if (providerRow.type === "github") {
    const tokenResult = await fetchGitHubInstallationToken({
      provider: providerRow,
      installationId: installation.installationId
    });
    if (tokenResult.status !== "ok") {
      return tokenResult;
    }

    const repoPath = encodeGitHubRepoPath(input.project.repoFullName);
    const response = await fetchWithTimeout(
      providerRow,
      `${buildGitHubApiBaseUrl(providerRow.baseUrl)}/repos/${repoPath}/contents/${encodeURIComponent(input.path)}?ref=${encodeURIComponent(input.branch)}`,
      {
        headers: {
          Accept: "application/vnd.github+json",
          Authorization: `Bearer ${tokenResult.token}`,
          "User-Agent": "DaoFlow"
        }
      }
    ).catch((error: unknown) => {
      throw new Error(error instanceof Error ? error.message : String(error));
    });

    if (response.status === 404) {
      return {
        status: "not_found",
        reason: `Repository file ${input.path} was not found in ${input.project.repoFullName}@${input.branch}.`
      };
    }
    if (!response.ok) {
      return {
        status: "not_available",
        reason: `GitHub returned status ${response.status} while reading ${input.path}.`
      };
    }

    const payload = (await response.json()) as { content?: string; encoding?: string };
    if (!payload.content) {
      return {
        status: "not_available",
        reason: `GitHub did not return file contents for ${input.path}.`
      };
    }

    return {
      status: "ok",
      content:
        payload.encoding === "base64"
          ? Buffer.from(payload.content.replace(/\n/g, ""), "base64").toString("utf8")
          : payload.content
    };
  }

  if (providerRow.type === "gitlab") {
    const apiAccess = await resolveGitLabInstallationApiAccess({
      provider: providerRow,
      installation
    });
    if (apiAccess.status === "capability_unavailable") {
      return readMaterializedProjectSourceFile(input);
    }
    if (apiAccess.status !== "ok") {
      return {
        status: "not_available",
        reason: `GitLab installation ${input.project.gitInstallationId} does not have usable API credentials.`
      };
    }

    const response = await fetchWithTimeout(
      providerRow,
      `${resolveGitLabApiBaseUrl(providerRow)}/projects/${encodeURIComponent(input.project.repoFullName)}/repository/files/${encodeURIComponent(input.path)}?ref=${encodeURIComponent(input.branch)}`,
      {
        headers: {
          Accept: "application/json",
          "User-Agent": "DaoFlow",
          ...apiAccess.headers
        }
      }
    ).catch((error: unknown) => {
      throw new Error(error instanceof Error ? error.message : String(error));
    });

    if (response.status === 404) {
      return {
        status: "not_found",
        reason: `Repository file ${input.path} was not found in ${input.project.repoFullName}@${input.branch}.`
      };
    }
    if (!response.ok) {
      return {
        status: "not_available",
        reason: `GitLab returned status ${response.status} while reading ${input.path}.`
      };
    }

    const payload = (await response.json()) as { content?: string; encoding?: string };
    if (!payload.content) {
      return {
        status: "not_available",
        reason: `GitLab did not return file contents for ${input.path}.`
      };
    }

    return {
      status: "ok",
      content:
        payload.encoding === "base64"
          ? Buffer.from(payload.content, "base64").toString("utf8")
          : payload.content
    };
  }

  return {
    status: "not_available",
    reason: `Unsupported git provider type: ${providerRow.type}.`
  };
}
