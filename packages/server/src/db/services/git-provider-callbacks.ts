import type { AppRole } from "@daoflow/shared";
import { decrypt } from "../crypto";
import { createGitInstallation, getGitProvider } from "./git-providers";
import {
  resolveGitLabRedirectUri,
  resolveGitProviderCallbackOrigin
} from "./git-provider-callback-urls";
import { createGitLabCredentialStorage } from "./gitlab-credentials";
import {
  resolveGitLabApiBaseUrl,
  resolveGitLabInternalBaseUrl,
  resolveGitLabPublicBaseUrl
} from "./gitlab-urls";
import {
  consumeGitProviderSetupState,
  readGitProviderSetupStateCodeVerifier
} from "./git-provider-setup-states";
import { isUserMemberOfTeam } from "./teams";
import { resolveGitLabTokenExpiresAt } from "./gitlab-installation-auth";

export { resolveGitProviderCallbackOrigin } from "./git-provider-callback-urls";

export function resolveGitLabBaseUrl(baseUrl?: string | null): string {
  return resolveGitLabPublicBaseUrl({ baseUrl: baseUrl ?? null });
}

export function buildGitLabAuthorizationUrl(input: {
  clientId: string;
  baseUrl: string | null;
  state: string;
  codeChallenge: string;
}): string {
  const authorizeUrl = new URL(
    "oauth/authorize",
    `${resolveGitLabPublicBaseUrl({ baseUrl: input.baseUrl })}/`
  );
  authorizeUrl.search = new URLSearchParams({
    client_id: input.clientId,
    redirect_uri: resolveGitLabRedirectUri(),
    response_type: "code",
    state: input.state,
    scope: "api read_repository",
    code_challenge: input.codeChallenge,
    code_challenge_method: "S256"
  }).toString();
  return authorizeUrl.toString();
}

function requireGitLabOAuthConfig(provider: {
  clientId?: string | null;
  clientSecretEncrypted?: string | null;
}) {
  const clientId = provider.clientId?.trim();
  if (!clientId || !provider.clientSecretEncrypted) return null;
  return { clientId, clientSecret: decrypt(provider.clientSecretEncrypted) };
}

function auditCredentialMetadata(provider: {
  baseUrl: string | null;
  internalBaseUrl: string | null;
}) {
  return {
    credentialKind: "oauth",
    credentialScopes: ["api", "read_repository"],
    credentialExpiresAt: null,
    publicHost: new URL(resolveGitLabPublicBaseUrl(provider)).host,
    internalHost: new URL(resolveGitLabInternalBaseUrl(provider)).host
  };
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

  if (!setup?.providerId || !(await isUserMemberOfTeam(input.initiatedByUserId, setup.teamId))) {
    return { status: "not_found" as const };
  }

  const provider = await getGitProvider(setup.providerId, setup.teamId);
  if (
    !provider ||
    provider.type !== "gitlab" ||
    !setup.providerPublicBaseUrl ||
    resolveGitLabPublicBaseUrl(provider) !== setup.providerPublicBaseUrl
  ) {
    return { status: "not_found" as const };
  }

  const oauthConfig = requireGitLabOAuthConfig(provider);
  const codeVerifier = readGitProviderSetupStateCodeVerifier(setup);
  if (!oauthConfig || !codeVerifier) {
    return { status: "invalid_provider" as const };
  }

  const tokenRequest = new URLSearchParams({
    client_id: oauthConfig.clientId,
    client_secret: oauthConfig.clientSecret,
    code: input.code,
    grant_type: "authorization_code",
    redirect_uri: resolveGitLabRedirectUri(),
    code_verifier: codeVerifier
  });
  const tokenResponse = await fetch(`${resolveGitLabInternalBaseUrl(provider)}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: tokenRequest.toString(),
    signal: AbortSignal.timeout(10_000)
  });

  if (!tokenResponse.ok) return { status: "exchange_failed" as const };

  const tokenData = (await tokenResponse.json()) as {
    access_token?: string;
    refresh_token?: string;
    token_type?: string;
    expires_in?: number;
    created_at?: number;
  };
  if (!tokenData.access_token || !tokenData.refresh_token) {
    return { status: "exchange_failed" as const };
  }

  const userResponse = await fetch(`${resolveGitLabApiBaseUrl(provider)}/user`, {
    headers: { Authorization: `Bearer ${tokenData.access_token}`, Accept: "application/json" },
    signal: AbortSignal.timeout(10_000)
  });
  if (!userResponse.ok) return { status: "exchange_failed" as const };

  const userData = (await userResponse.json()) as { username?: string; id?: number | string };
  if (!userData.id || !userData.username) return { status: "exchange_failed" as const };

  return createGitInstallation({
    teamId: setup.teamId,
    providerId: provider.id,
    installationId: String(userData.id),
    accountName: userData.username,
    accountType: "user",
    credentialStorage: createGitLabCredentialStorage({
      kind: "oauth",
      accessToken: tokenData.access_token,
      refreshToken: tokenData.refresh_token,
      tokenType: tokenData.token_type,
      expiresAt: resolveGitLabTokenExpiresAt(tokenData)
    }),
    installedByUserId: input.initiatedByUserId,
    requestedByUserId: input.initiatedByUserId,
    requestedByEmail: input.requestedByEmail,
    requestedByRole: input.requestedByRole,
    auditMetadata: auditCredentialMetadata(provider)
  });
}
