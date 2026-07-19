import { and, eq, isNull, sql } from "drizzle-orm";
import { db } from "../connection";
import { decrypt } from "../crypto";
import { gitInstallations, gitProviders } from "../schema/git-providers";
import {
  createGitLabCredentialStorage,
  readGitLabCredential,
  type ResolvedGitLabCredential
} from "./gitlab-credentials";
import { resolveGitLabRedirectUri } from "./git-provider-callback-urls";
import { resolveGitLabApiBaseUrl, resolveGitLabInternalBaseUrl } from "./gitlab-urls";
import { readLegacyGitInstallationOAuthCredentials } from "./git-installation-legacy-credentials";

const REFRESH_SKEW_MS = 60_000;

type GitLabProviderAuthRecord = Pick<
  typeof gitProviders.$inferSelect,
  "id" | "teamId" | "baseUrl" | "internalBaseUrl" | "clientId" | "clientSecretEncrypted"
>;

type GitLabInstallationAuthRecord = Pick<
  typeof gitInstallations.$inferSelect,
  | "id"
  | "teamId"
  | "providerId"
  | "permissions"
  | "credentialKind"
  | "credentialScopes"
  | "credentialExpiresAt"
  | "credentialEncrypted"
  | "credentialEnvelopeVersion"
>;

type StoredGitLabCredential = {
  credential: ResolvedGitLabCredential;
  legacy: boolean;
};

export type GitLabApiAccess =
  | {
      status: "ok";
      credentialKind: "oauth" | "api_token";
      headers: Record<string, string>;
    }
  | {
      status: "capability_unavailable";
      credentialKind: "deploy_token";
      capability: "api";
    }
  | { status: "unavailable" };

export class GitLabCredentialValidationError extends Error {
  constructor() {
    super("GitLab API token validation failed.");
    this.name = "GitLabCredentialValidationError";
  }
}

function readStoredCredential(
  installation: GitLabInstallationAuthRecord
): StoredGitLabCredential | null {
  const credential = readGitLabCredential(installation);
  if (credential) return { credential, legacy: false };

  const legacy = readLegacyGitInstallationOAuthCredentials(installation);
  if (!legacy) return null;
  return {
    legacy: true,
    credential: {
      kind: "oauth",
      accessToken: legacy.accessToken,
      refreshToken: legacy.refreshToken,
      tokenType: legacy.tokenType,
      expiresAt: legacy.expiresAt,
      scopes: ["api", "read_repository"]
    }
  };
}

function needsRefresh(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const expiryMs = new Date(expiresAt).getTime();
  return !Number.isFinite(expiryMs) || expiryMs <= Date.now() + REFRESH_SKEW_MS;
}

function isExpired(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const expiryMs = new Date(expiresAt).getTime();
  return !Number.isFinite(expiryMs) || expiryMs <= Date.now();
}

function credentialStorage(credential: ResolvedGitLabCredential) {
  if (credential.kind === "oauth") {
    return createGitLabCredentialStorage({
      kind: "oauth",
      accessToken: credential.accessToken,
      ...(credential.refreshToken ? { refreshToken: credential.refreshToken } : {}),
      tokenType: credential.tokenType,
      ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {})
    });
  }
  if (credential.kind === "api_token") {
    return createGitLabCredentialStorage({
      kind: "api_token",
      token: credential.token,
      ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {})
    });
  }
  return createGitLabCredentialStorage({
    kind: "deploy_token",
    username: credential.username,
    token: credential.token,
    ...(credential.expiresAt ? { expiresAt: credential.expiresAt } : {})
  });
}

async function migrateLegacyCredential(
  installation: GitLabInstallationAuthRecord,
  credential: ResolvedGitLabCredential
) {
  const storage = credentialStorage(credential);
  await db
    .update(gitInstallations)
    .set({ ...storage, permissions: null, updatedAt: new Date() })
    .where(
      and(
        eq(gitInstallations.id, installation.id),
        eq(gitInstallations.teamId, installation.teamId),
        isNull(gitInstallations.credentialEncrypted)
      )
    );
}

function requireGitLabOAuthConfig(provider: GitLabProviderAuthRecord) {
  const clientId = provider.clientId?.trim();
  if (!clientId || !provider.clientSecretEncrypted) return null;
  return { clientId, clientSecret: decrypt(provider.clientSecretEncrypted) };
}

export function resolveGitLabTokenExpiresAt(input: {
  created_at?: number;
  expires_in?: number;
}): string | undefined {
  if (!input.expires_in || !Number.isFinite(input.expires_in)) return undefined;
  const issuedAtSeconds =
    input.created_at && Number.isFinite(input.created_at)
      ? input.created_at
      : Math.floor(Date.now() / 1000);
  return new Date((issuedAtSeconds + input.expires_in) * 1000).toISOString();
}

async function refreshGitLabOAuthCredential(input: {
  provider: GitLabProviderAuthRecord;
  installation: GitLabInstallationAuthRecord;
}): Promise<ResolvedGitLabCredential | null> {
  return db.transaction(async (tx) => {
    await tx.execute(
      sql`select ${gitInstallations.id} from ${gitInstallations}
          where ${gitInstallations.id} = ${input.installation.id}
            and ${gitInstallations.teamId} = ${input.installation.teamId}
          for update`
    );

    const [installation] = await tx
      .select()
      .from(gitInstallations)
      .where(
        and(
          eq(gitInstallations.id, input.installation.id),
          eq(gitInstallations.providerId, input.provider.id),
          eq(gitInstallations.teamId, input.provider.teamId)
        )
      )
      .limit(1);
    if (!installation) return null;

    const current = readStoredCredential(installation);
    if (!current || current.credential.kind !== "oauth") return current?.credential ?? null;
    if (!needsRefresh(current.credential.expiresAt)) {
      if (current.legacy) {
        const storage = credentialStorage(current.credential);
        await tx
          .update(gitInstallations)
          .set({ ...storage, permissions: null, updatedAt: new Date() })
          .where(eq(gitInstallations.id, installation.id));
      }
      return current.credential;
    }

    const oauthConfig = requireGitLabOAuthConfig(input.provider);
    if (!current.credential.refreshToken || !oauthConfig) return null;

    const response = await fetch(`${resolveGitLabInternalBaseUrl(input.provider)}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: oauthConfig.clientId,
        client_secret: oauthConfig.clientSecret,
        grant_type: "refresh_token",
        refresh_token: current.credential.refreshToken,
        redirect_uri: resolveGitLabRedirectUri()
      }).toString(),
      signal: AbortSignal.timeout(10_000)
    });
    if (!response.ok) {
      throw new Error(`GitLab token refresh failed with status ${response.status}.`);
    }

    const token = (await response.json()) as {
      access_token?: string;
      refresh_token?: string;
      token_type?: string;
      expires_in?: number;
      created_at?: number;
    };
    if (!token.access_token || !token.refresh_token) {
      throw new Error("GitLab token refresh did not return a rotated token pair.");
    }

    const refreshed: ResolvedGitLabCredential = {
      kind: "oauth",
      accessToken: token.access_token,
      refreshToken: token.refresh_token,
      tokenType: token.token_type ?? "Bearer",
      expiresAt: resolveGitLabTokenExpiresAt(token) ?? null,
      scopes: current.credential.scopes
    };
    const storage = credentialStorage(refreshed);
    await tx
      .update(gitInstallations)
      .set({ ...storage, permissions: null, updatedAt: new Date() })
      .where(eq(gitInstallations.id, installation.id));
    return refreshed;
  });
}

export async function resolveGitLabInstallationCredential(input: {
  provider: GitLabProviderAuthRecord;
  installation: GitLabInstallationAuthRecord;
}): Promise<ResolvedGitLabCredential | null> {
  const initial = readStoredCredential(input.installation);
  if (!initial) return null;
  if (initial.credential.kind !== "oauth") {
    return isExpired(initial.credential.expiresAt) ? null : initial.credential;
  }

  if (!needsRefresh(initial.credential.expiresAt)) {
    if (initial.legacy) {
      await migrateLegacyCredential(input.installation, initial.credential);
    }
    return initial.credential;
  }

  return refreshGitLabOAuthCredential(input);
}

export async function resolveGitLabInstallationAccessToken(input: {
  provider: GitLabProviderAuthRecord;
  installation: GitLabInstallationAuthRecord;
}): Promise<string | null> {
  const credential = await resolveGitLabInstallationCredential(input);
  return credential?.kind === "oauth" ? credential.accessToken : null;
}

export async function resolveGitLabInstallationApiAccess(input: {
  provider: GitLabProviderAuthRecord;
  installation: GitLabInstallationAuthRecord;
}): Promise<GitLabApiAccess> {
  const credential = await resolveGitLabInstallationCredential(input);
  if (!credential) return { status: "unavailable" };
  if (credential.kind === "deploy_token") {
    return { status: "capability_unavailable", credentialKind: "deploy_token", capability: "api" };
  }
  return credential.kind === "oauth"
    ? {
        status: "ok",
        credentialKind: "oauth",
        headers: { Authorization: `Bearer ${credential.accessToken}` }
      }
    : {
        status: "ok",
        credentialKind: "api_token",
        headers: { "PRIVATE-TOKEN": credential.token }
      };
}

export async function validateGitLabApiToken(input: {
  baseUrl: string | null;
  internalBaseUrl?: string | null;
  token: string;
}): Promise<{ id: string; username: string }> {
  try {
    const response = await fetch(
      `${resolveGitLabApiBaseUrl({
        baseUrl: input.baseUrl,
        internalBaseUrl: input.internalBaseUrl ?? null
      })}/user`,
      {
        headers: {
          "PRIVATE-TOKEN": input.token,
          Accept: "application/json",
          "User-Agent": "DaoFlow"
        },
        signal: AbortSignal.timeout(10_000)
      }
    );
    if (!response.ok) throw new GitLabCredentialValidationError();
    const user = (await response.json()) as { id?: number | string; username?: string };
    if (!user.id || !user.username) throw new GitLabCredentialValidationError();
    return { id: String(user.id), username: user.username };
  } catch (error) {
    if (error instanceof GitLabCredentialValidationError) throw error;
    throw new GitLabCredentialValidationError();
  }
}
