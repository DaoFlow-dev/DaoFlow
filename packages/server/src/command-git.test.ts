import { generateKeyPairSync } from "node:crypto";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { and, eq } from "drizzle-orm";
import type { Context } from "./context";
import { appRouter } from "./router";
import { resetSeededTestDatabase } from "./test-db";
import { db } from "./db/connection";
import { encrypt } from "./db/crypto";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { auditEntries } from "./db/schema/audit";
import { teams, teamMembers } from "./db/schema/teams";
import { users } from "./db/schema/users";
import { readGitInstallationAccessToken } from "./db/services/git-providers";
import { resolveGitProviderCallbackOrigin } from "./db/services/git-provider-callbacks";

const originalAppBaseUrl = process.env.APP_BASE_URL;
const originalBetterAuthUrl = process.env.BETTER_AUTH_URL;

function restoreEnvironment(name: string, value: string | undefined) {
  if (value === undefined) {
    delete process.env[name];
  } else {
    process.env[name] = value;
  }
}

function makeSession(input: { userId: string; email: string }): NonNullable<Context["session"]> {
  return {
    user: {
      id: input.userId,
      email: input.email,
      name: input.email,
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      image: null,
      role: "admin"
    },
    session: {
      id: `session_${input.userId}`,
      userId: input.userId,
      expiresAt: new Date(),
      token: `token_${input.userId}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null
    }
  } as unknown as NonNullable<Context["session"]>;
}

function foundationCaller() {
  return appRouter.createCaller({
    requestId: "test-foundation-git-callback",
    session: makeSession({
      userId: "user_foundation_owner",
      email: "owner@daoflow.local"
    })
  });
}

describe("command git router", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
    process.env.APP_BASE_URL = "https://demo.daoflow.dev/";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    restoreEnvironment("APP_BASE_URL", originalAppBaseUrl);
    restoreEnvironment("BETTER_AUTH_URL", originalBetterAuthUrl);
  });

  it("uses BETTER_AUTH_URL as the production callback origin", () => {
    delete process.env.APP_BASE_URL;
    process.env.BETTER_AUTH_URL = "https://deploy.example.com/control-plane";

    expect(resolveGitProviderCallbackOrigin()).toBe("https://deploy.example.com");
  });

  it("loads the authenticated GitHub App slug before starting installation", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const providerId = `gitprov_slug_${Date.now()}`.slice(0, 32);
    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "github",
      name: "A display name that is not the app slug",
      appId: "123456",
      clientId: "Iv1.github-client",
      clientSecretEncrypted: encrypt("github-client-secret"),
      privateKeyEncrypted: encrypt(privateKey.export({ format: "pem", type: "pkcs1" }).toString()),
      status: "active",
      updatedAt: new Date()
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      expect(String(input instanceof Request ? input.url : input)).toBe(
        "https://api.github.com/app"
      );
      expect(new Headers(init?.headers).get("Authorization")).toMatch(/^Bearer /);
      return Promise.resolve(
        new Response(JSON.stringify({ slug: "verified-app-slug" }), { status: 200 })
      );
    });

    const started = await foundationCaller().startGitProviderSetup({ providerId });
    const authorizationUrl = new URL(started.authorizationUrl);

    expect(authorizationUrl.origin + authorizationUrl.pathname).toBe(
      "https://github.com/apps/verified-app-slug/installations/new"
    );
    expect(authorizationUrl.searchParams.get("state")).toMatch(/^[a-f0-9]{32}$/);
    expect(fetchMock).toHaveBeenCalledOnce();
  });

  it("uses a single-use, team-and-user-bound state for self-hosted GitLab OAuth", async () => {
    const providerId = `gitprov_exchange_${Date.now()}`.slice(0, 32);
    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "gitlab",
      name: `GitLab Exchange ${Date.now()}`,
      clientId: "gitlab-client-id",
      clientSecretEncrypted: encrypt("gitlab-client-secret"),
      baseUrl: "https://gitlab.example.com/gitlab/",
      status: "active",
      updatedAt: new Date()
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://gitlab.example.com/gitlab/oauth/token") {
        expect(init?.method).toBe("POST");
        const params = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
        expect(Object.fromEntries(params.entries())).toMatchObject({
          client_id: "gitlab-client-id",
          client_secret: "gitlab-client-secret",
          code: "oauth-code",
          redirect_uri: "https://demo.daoflow.dev/settings/git/callback"
        });
        return Promise.resolve(
          new Response(
            JSON.stringify({
              access_token: "gl-access-token",
              refresh_token: "gl-refresh-token",
              token_type: "Bearer",
              expires_in: 7200,
              created_at: 1_784_393_200
            }),
            { status: 200 }
          )
        );
      }
      if (url === "https://gitlab.example.com/gitlab/api/v4/user") {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer gl-access-token");
        return Promise.resolve(
          new Response(JSON.stringify({ id: 703, username: "example-group" }), { status: 200 })
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const caller = foundationCaller();
    const started = await caller.startGitProviderSetup({ providerId });
    const authorizationUrl = new URL(started.authorizationUrl);
    expect(authorizationUrl.pathname).toBe("/gitlab/oauth/authorize");
    const state = authorizationUrl.searchParams.get("state");
    expect(state).toMatch(/^[a-f0-9]{32}$/);

    const installation = await caller.completeGitLabOAuthSetup({
      code: "oauth-code",
      state: state ?? ""
    });

    expect(installation).toMatchObject({
      providerId,
      installationId: "703",
      accountName: "example-group",
      accountType: "user"
    });
    expect(installation).not.toHaveProperty("permissions");
    expect(fetchMock).toHaveBeenCalledTimes(2);

    const [stored] = await db
      .select()
      .from(gitInstallations)
      .where(eq(gitInstallations.id, installation.id));
    expect(stored?.teamId).toBe("team_foundation");
    expect(stored && readGitInstallationAccessToken(stored)).toBe("gl-access-token");

    const [audit] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `git_installation/${installation.id}`));
    expect(audit?.metadata).toMatchObject({
      teamId: "team_foundation",
      providerId,
      externalInstallationId: "703"
    });
    expect(JSON.stringify(audit?.metadata)).not.toContain("gl-access-token");

    await expect(
      caller.completeGitLabOAuthSetup({ code: "oauth-code", state: state ?? "" })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it("does not allow a second team or user to complete another team's OAuth state", async () => {
    const providerId = `gitprov_state_${Date.now()}`.slice(0, 32);
    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "gitlab",
      name: `GitLab State ${Date.now()}`,
      clientId: "gitlab-client-id",
      clientSecretEncrypted: encrypt("gitlab-client-secret"),
      status: "active",
      updatedAt: new Date()
    });
    await db.insert(teams).values({
      id: "team_scm_other",
      name: "SCM Other",
      slug: "scm-other",
      createdByUserId: "user_developer",
      updatedAt: new Date()
    });
    await db.insert(teamMembers).values({
      teamId: "team_scm_other",
      userId: "user_developer",
      role: "owner"
    });
    await db
      .update(users)
      .set({ defaultTeamId: "team_scm_other", updatedAt: new Date() })
      .where(eq(users.id, "user_developer"));

    const started = await foundationCaller().startGitProviderSetup({ providerId });
    const state = new URL(started.authorizationUrl).searchParams.get("state") ?? "";
    const otherCaller = appRouter.createCaller({
      requestId: "test-other-team-git-callback",
      session: makeSession({ userId: "user_developer", email: "developer@daoflow.local" })
    });

    await expect(
      otherCaller.completeGitLabOAuthSetup({ code: "oauth-code", state })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(await db.select().from(gitInstallations)).toHaveLength(0);
  });

  it("rejects GitLab OAuth completion after the initiating user leaves the team", async () => {
    const providerId = `gitprov_removed_${Date.now()}`.slice(0, 32);
    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "gitlab",
      name: `GitLab Removed ${Date.now()}`,
      clientId: "gitlab-client-id",
      clientSecretEncrypted: encrypt("gitlab-client-secret"),
      status: "active",
      updatedAt: new Date()
    });

    const caller = foundationCaller();
    const started = await caller.startGitProviderSetup({ providerId });
    const state = new URL(started.authorizationUrl).searchParams.get("state") ?? "";
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, "team_foundation"),
          eq(teamMembers.userId, "user_foundation_owner")
        )
      );
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await expect(
      caller.completeGitLabOAuthSetup({ code: "oauth-code", state })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(gitInstallations)).toHaveLength(0);
  });
});
