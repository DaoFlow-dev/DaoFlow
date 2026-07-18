import { decrypt } from "../crypto";
import {
  createGitInstallation,
  encodeGitInstallationPermissions,
  getGitProvider
} from "./git-providers";
import { consumeGitProviderSetupState } from "./git-provider-setup-states";
import { isUserMemberOfTeam } from "./teams";
import { resolveGitLabTokenExpiresAt } from "./gitlab-installation-auth";
import type { AppRole } from "@daoflow/shared";

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

export function resolveGitLabBaseUrl(baseUrl?: string | null): string {
  return trimTrailingSlash(baseUrl || "https://gitlab.com");
}

export function buildGitLabAuthorizationUrl(input: {
  clientId: string;
  baseUrl: string | null;
  state: string;
}): string {
  const authorizeUrl = new URL("oauth/authorize", `${resolveGitLabBaseUrl(input.baseUrl)}/`);
  authorizeUrl.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: resolveGitLabRedirectUri(),
    response_type: "code",
    state: input.state,
    scope: "api"
  }).toString();
  return authorizeUrl.toString();
}

function requireGitLabOAuthConfig(provider: {
  clientId?: string | null;
  clientSecretEncrypted?: string | null;
}) {
  const clientId = provider.clientId?.trim();
  if (!clientId || !provider.clientSecretEncrypted) {
    return null;
  }

  return { clientId, clientSecret: decrypt(provider.clientSecretEncrypted) };
}

export async function completeGitLabOAuthSetup(input: {
  state: string;
  code: string;
  initiatedByUserId: string;
  requestedByEmail: string;
  requestedByRole: AppRole;
}) {
  const setup = await consumeGitProviderSetupState({
    state: input.state,
    providerType: "gitlab",
    action: "gitlab_oauth",
    callbackOrigin: resolveGitProviderCallbackOrigin(),
    initiatedByUserId: input.initiatedByUserId
  });

  if (!setup?.providerId) {
    return { status: "not_found" as const };
  }
  if (!(await isUserMemberOfTeam(input.initiatedByUserId, setup.teamId))) {
    return { status: "not_found" as const };
  }

  const provider = await getGitProvider(setup.providerId, setup.teamId);
  if (!provider || provider.type !== "gitlab") {
    return { status: "not_found" as const };
  }

  const oauthConfig = requireGitLabOAuthConfig(provider);
  if (!oauthConfig) {
    return { status: "invalid_provider" as const };
  }

  const gitlabBaseUrl = resolveGitLabBaseUrl(provider.baseUrl);
  const tokenRequest = new URLSearchParams({
    client_id: oauthConfig.clientId,
    client_secret: oauthConfig.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: resolveGitLabRedirectUri()
  });
  const tokenResponse = await fetch(`${gitlabBaseUrl}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenRequest.toString()
  });

  if (!tokenResponse.ok) {
    return { status: "exchange_failed" as const, detail: await tokenResponse.text() };
  }

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    created_at?: number;
  };
  if (!tokenData.access_token || !tokenData.refresh_token) {
    return {
      status: "exchange_failed" as const,
      detail: "GitLab did not return a complete access and refresh token pair."
    };
  }

  const userResponse = await fetch(`${gitlabBaseUrl}/api/v4/user`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}` }
  });
  if (!userResponse.ok) {
    return { status: "exchange_failed" as const, detail: await userResponse.text() };
  }

  const userData = (await userResponse.json()) as { username?: string; id?: number | string };
  if (!userData.id || !userData.username) {
    return { status: "exchange_failed" as const, detail: "GitLab user lookup was incomplete." };
  }

  return createGitInstallation({
    teamId: setup.teamId,
    providerId: provider.id,
    installationId: String(userData.id),
    accountName: userData.username,
    accountType: "user",
    permissions: encodeGitInstallationPermissions({
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenType: tokenData.token_type,
      expiresAt: resolveGitLabTokenExpiresAt(tokenData)
    }),
    installedByUserId: input.initiatedByUserId,
    requestedByUserId: input.initiatedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole
  });
}
