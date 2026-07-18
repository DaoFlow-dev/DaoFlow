import { and, eq, sql } from "drizzle-orm";
import { db } from "../connection";
import { decrypt } from "../crypto";
import { gitInstallations, gitProviders } from "../schema/git-providers";
import {
  encodeGitInstallationPermissions,
  readGitInstallationOAuthCredentials
} from "./git-providers";

const REFRESH_SKEW_MS = 60_000;

function trimTrailingSlash(value: string): string {
  return value.replace(/\/+$/, "");
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

function needsRefresh(expiresAt: string | null): boolean {
  if (!expiresAt) return false;
  const expiryMs = new Date(expiresAt).getTime();
  return !Number.isFinite(expiryMs) || expiryMs <= Date.now() + REFRESH_SKEW_MS;
}

export async function resolveGitLabInstallationAccessToken(input: {
  provider: Pick<
    typeof gitProviders.$inferSelect,
    "id" | "teamId" | "baseUrl" | "clientId" | "clientSecretEncrypted"
  >;
  installation: Pick<
    typeof gitInstallations.$inferSelect,
    "id" | "teamId" | "providerId" | "permissions"
  >;
}): Promise<string | null> {
  const initial = readGitInstallationOAuthCredentials(input.installation);
  if (!initial) return null;
  if (!needsRefresh(initial.expiresAt)) return initial.accessToken;
  if (!initial.refreshToken) return null;

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

    const current = readGitInstallationOAuthCredentials(installation);
    if (!current) return null;
    if (!needsRefresh(current.expiresAt)) return current.accessToken;
    if (
      !current.refreshToken ||
      !input.provider.clientId ||
      !input.provider.clientSecretEncrypted
    ) {
      return null;
    }

    const baseUrl = trimTrailingSlash(input.provider.baseUrl || "https://gitlab.com");
    const response = await fetch(`${baseUrl}/oauth/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        client_id: input.provider.clientId,
        client_secret: decrypt(input.provider.clientSecretEncrypted),
        grant_type: "refresh_token",
        refresh_token: current.refreshToken
      }).toString()
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

    await tx
      .update(gitInstallations)
      .set({
        permissions: encodeGitInstallationPermissions({
          accessToken: token.access_token,
          refreshToken: token.refresh_token,
          tokenType: token.token_type,
          expiresAt: resolveGitLabTokenExpiresAt(token)
        }),
        updatedAt: new Date()
      })
      .where(eq(gitInstallations.id, installation.id));

    return token.access_token;
  });
}
