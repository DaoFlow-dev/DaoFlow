import type { gitProviders } from "../schema/git-providers";

const DEFAULT_GITLAB_BASE_URL = "https://gitlab.com";

type GitLabProviderUrls = Pick<typeof gitProviders.$inferSelect, "baseUrl" | "internalBaseUrl">;

function formatBaseUrl(url: URL): string {
  const path = url.pathname.replace(/\/+$/, "");
  return `${url.origin}${path === "/" ? "" : path}`;
}

export function normalizeGitLabBaseUrl(value: string): string {
  let url: URL;
  try {
    url = new URL(value.trim());
  } catch {
    throw new Error("GitLab URLs must be valid http or https URLs.");
  }

  if (url.protocol !== "http:" && url.protocol !== "https:") {
    throw new Error("GitLab URLs must use http or https.");
  }
  if (url.username || url.password || url.search || url.hash) {
    throw new Error("GitLab URLs cannot include credentials, queries, or fragments.");
  }

  return formatBaseUrl(url);
}

export function resolveGitLabPublicBaseUrl(provider: Pick<GitLabProviderUrls, "baseUrl">): string {
  return normalizeGitLabBaseUrl(provider.baseUrl || DEFAULT_GITLAB_BASE_URL);
}

export function resolveGitLabInternalBaseUrl(provider: GitLabProviderUrls): string {
  return normalizeGitLabBaseUrl(
    provider.internalBaseUrl || provider.baseUrl || DEFAULT_GITLAB_BASE_URL
  );
}

export function buildGitLabApiBaseUrl(baseUrl: string | null): string {
  const normalized = normalizeGitLabBaseUrl(baseUrl || DEFAULT_GITLAB_BASE_URL);
  return normalized.endsWith("/api/v4") ? normalized : `${normalized}/api/v4`;
}

export function resolveGitLabApiBaseUrl(provider: GitLabProviderUrls): string {
  return buildGitLabApiBaseUrl(resolveGitLabInternalBaseUrl(provider));
}

export function resolveGitLabCloneBaseUrl(provider: GitLabProviderUrls): string {
  return resolveGitLabInternalBaseUrl(provider);
}

export function gitLabBaseUrlHost(baseUrl: string | null | undefined): string | null {
  if (!baseUrl) return null;
  try {
    return new URL(baseUrl).host;
  } catch {
    return null;
  }
}
