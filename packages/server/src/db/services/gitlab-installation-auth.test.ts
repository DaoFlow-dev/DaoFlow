import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../connection";
import { encrypt } from "../crypto";
import { gitInstallations, gitProviders } from "../schema/git-providers";
import { teams } from "../schema/teams";
import { resetTestDatabase } from "../../test-db";
import {
  encodeGitInstallationPermissions,
  readGitInstallationOAuthCredentials
} from "./git-providers";
import { createGitLabCredentialStorage } from "./gitlab-credentials";
import {
  resolveGitLabInstallationAccessToken,
  resolveGitLabInstallationApiAccess,
  resolveGitLabInstallationCredential
} from "./gitlab-installation-auth";

describe("GitLab installation OAuth credentials", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await db.insert(teams).values({
      id: "team_foundation",
      name: "Foundation",
      slug: "foundation",
      updatedAt: new Date()
    });
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("refreshes an expired token pair once across concurrent checkout requests", async () => {
    const providerId = "gitprov_refresh_lock";
    const installationId = "gitinst_refresh_lock";
    const [provider] = await db
      .insert(gitProviders)
      .values({
        id: providerId,
        teamId: "team_foundation",
        type: "gitlab",
        name: "GitLab Refresh Lock",
        clientId: "gitlab-refresh-client",
        clientSecretEncrypted: encrypt("gitlab-refresh-secret"),
        baseUrl: "https://gitlab.example.com/gitlab",
        status: "active",
        updatedAt: new Date()
      })
      .returning();
    const [installation] = await db
      .insert(gitInstallations)
      .values({
        id: installationId,
        teamId: "team_foundation",
        providerId,
        installationId: "703",
        accountName: "example-group",
        accountType: "user",
        repositorySelection: "all",
        permissions: encodeGitInstallationPermissions({
          accessToken: "expired-access-token",
          refreshToken: "refresh-token-1",
          expiresAt: "2026-07-18T15:00:00.000Z"
        }),
        status: "active",
        updatedAt: new Date()
      })
      .returning();

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((_url, init) => {
      const params = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
      expect(params.get("grant_type")).toBe("refresh_token");
      expect(params.get("refresh_token")).toBe("refresh-token-1");
      expect(params.get("redirect_uri")).toBe("http://localhost:3000/settings/git/callback");
      expect(init?.signal).toBeTruthy();
      return Promise.resolve(
        new Response(
          JSON.stringify({
            access_token: "rotated-access-token",
            refresh_token: "refresh-token-2",
            token_type: "Bearer",
            expires_in: 7200,
            created_at: Math.floor(Date.now() / 1000)
          }),
          { status: 200 }
        )
      );
    });

    const tokens = await Promise.all([
      resolveGitLabInstallationAccessToken({ provider, installation }),
      resolveGitLabInstallationAccessToken({ provider, installation })
    ]);
    expect(tokens).toEqual(["rotated-access-token", "rotated-access-token"]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(fetchMock.mock.calls[0]?.[0]).toBe("https://gitlab.example.com/gitlab/oauth/token");

    const [stored] = await db
      .select()
      .from(gitInstallations)
      .where(eq(gitInstallations.id, installationId));
    expect(readGitInstallationOAuthCredentials(stored)).toMatchObject({
      accessToken: "rotated-access-token",
      refreshToken: "refresh-token-2",
      tokenType: "Bearer"
    });
    expect(stored?.permissions).toBeNull();
  });

  it("lazily upgrades legacy encrypted OAuth permissions into the credential envelope", async () => {
    const providerId = "gitprov_legacy_migrate";
    const installationId = "gitinst_legacy_migrate";
    const [provider] = await db
      .insert(gitProviders)
      .values({
        id: providerId,
        teamId: "team_foundation",
        type: "gitlab",
        name: "GitLab Legacy Migration",
        status: "active",
        updatedAt: new Date()
      })
      .returning();
    const [installation] = await db
      .insert(gitInstallations)
      .values({
        id: installationId,
        teamId: "team_foundation",
        providerId,
        installationId: "704",
        accountName: "legacy-user",
        accountType: "user",
        repositorySelection: "all",
        permissions: encodeGitInstallationPermissions({
          accessToken: "legacy-access-token",
          refreshToken: "legacy-refresh-token",
          expiresAt: "2099-12-31T00:00:00.000Z"
        }),
        status: "active",
        updatedAt: new Date()
      })
      .returning();

    await expect(
      resolveGitLabInstallationCredential({ provider, installation })
    ).resolves.toMatchObject({
      kind: "oauth",
      accessToken: "legacy-access-token"
    });

    const [stored] = await db
      .select()
      .from(gitInstallations)
      .where(eq(gitInstallations.id, installationId));
    expect(stored).toMatchObject({
      credentialKind: "oauth",
      credentialEnvelopeVersion: 1,
      permissions: null
    });
    expect(stored?.credentialEncrypted).not.toContain("legacy-access-token");
    expect(stored?.credentialEncrypted).not.toContain("legacy-refresh-token");
    expect(readGitInstallationOAuthCredentials(stored)).toMatchObject({
      accessToken: "legacy-access-token",
      refreshToken: "legacy-refresh-token"
    });
  });

  it("fails safely when GitLab rejects an OAuth refresh and preserves the stored token pair", async () => {
    const providerId = "gitprov_refresh_failure";
    const installationId = "gitinst_refresh_failure";
    const [provider] = await db
      .insert(gitProviders)
      .values({
        id: providerId,
        teamId: "team_foundation",
        type: "gitlab",
        name: "GitLab Refresh Failure",
        clientId: "gitlab-refresh-client",
        clientSecretEncrypted: encrypt("gitlab-refresh-secret"),
        status: "active",
        updatedAt: new Date()
      })
      .returning();
    const [installation] = await db
      .insert(gitInstallations)
      .values({
        id: installationId,
        teamId: "team_foundation",
        providerId,
        installationId: "705",
        accountName: "refresh-failure-user",
        accountType: "user",
        repositorySelection: "all",
        ...createGitLabCredentialStorage({
          kind: "oauth",
          accessToken: "stored-access-token",
          refreshToken: "stored-refresh-token",
          expiresAt: "2020-01-01T00:00:00.000Z"
        }),
        status: "active",
        updatedAt: new Date()
      })
      .returning();
    vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response("provider unavailable", { status: 503 })
    );

    const refresh = resolveGitLabInstallationCredential({ provider, installation });
    await expect(refresh).rejects.toThrow("GitLab token refresh failed with status 503.");
    await expect(refresh).rejects.not.toThrow("stored-refresh-token");

    const [stored] = await db
      .select()
      .from(gitInstallations)
      .where(eq(gitInstallations.id, installationId));
    expect(readGitInstallationOAuthCredentials(stored)).toMatchObject({
      accessToken: "stored-access-token",
      refreshToken: "stored-refresh-token"
    });
  });

  it("fails closed for expired static API and deploy credentials", async () => {
    const providerId = "gitprov_static_expiry";
    const [provider] = await db
      .insert(gitProviders)
      .values({
        id: providerId,
        teamId: "team_foundation",
        type: "gitlab",
        name: "GitLab Static Expiry",
        status: "active",
        updatedAt: new Date()
      })
      .returning();
    const [apiInstallation, deployInstallation] = await db
      .insert(gitInstallations)
      .values([
        {
          id: "gitinst_static_api",
          teamId: "team_foundation",
          providerId,
          installationId: "static-api",
          accountName: "api-user",
          accountType: "user",
          repositorySelection: "all",
          ...createGitLabCredentialStorage({
            kind: "api_token",
            token: "expired-api-token",
            expiresAt: "2020-01-01T00:00:00.000Z"
          }),
          status: "active",
          updatedAt: new Date()
        },
        {
          id: "gitinst_static_deploy",
          teamId: "team_foundation",
          providerId,
          installationId: "static-deploy",
          accountName: "deploy-user",
          accountType: "deploy_token",
          repositorySelection: "all",
          ...createGitLabCredentialStorage({
            kind: "deploy_token",
            username: "deploy-user",
            token: "expired-deploy-token",
            expiresAt: "2020-01-01T00:00:00.000Z"
          }),
          status: "active",
          updatedAt: new Date()
        }
      ])
      .returning();

    await expect(
      resolveGitLabInstallationCredential({ provider, installation: apiInstallation })
    ).resolves.toBeNull();
    await expect(
      resolveGitLabInstallationCredential({ provider, installation: deployInstallation })
    ).resolves.toBeNull();
    await expect(
      resolveGitLabInstallationApiAccess({ provider, installation: deployInstallation })
    ).resolves.toEqual({ status: "unavailable" });
  });
});
