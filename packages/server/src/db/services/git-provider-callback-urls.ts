const DEFAULT_APP_BASE_URL = "http://localhost:3000";
const GITLAB_CALLBACK_PATH = "/settings/git/callback";

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
}

export function resolveGitProviderCallbackOrigin(): string {
  const configured = trimTrailingSlash(
    process.env.APP_BASE_URL || process.env.BETTER_AUTH_URL || DEFAULT_APP_BASE_URL
  );
  return new URL(configured).origin;
}

export function resolveGitLabRedirectUri(): string {
  return new URL(GITLAB_CALLBACK_PATH, `${resolveGitProviderCallbackOrigin()}/`).toString();
}
