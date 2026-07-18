import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../connection";
import { encrypt } from "../crypto";
import { gitInstallations, gitProviders } from "../schema/git-providers";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import {
  encodeGitInstallationPermissions,
  readGitInstallationOAuthCredentials
} from "./git-providers";
import { resolveGitLabInstallationAccessToken } from "./gitlab-installation-auth";

describe("GitLab installation OAuth credentials", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
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
    expect(stored?.permissions).not.toContain("rotated-access-token");
    expect(stored?.permissions).not.toContain("refresh-token-2");
  });
});
