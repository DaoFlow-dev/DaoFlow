import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import type { Context } from "./context";
import { appRouter } from "./router";
import { resetSeededTestDatabase } from "./test-db";
import { db } from "./db/connection";
import { encrypt } from "./db/crypto";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { readGitInstallationAccessToken } from "./db/services/git-providers";

function makeSession(role: string): NonNullable<Context["session"]> {
  return {
    user: {
      id: "user_foundation_owner",
      email: "owner@daoflow.local",
      name: "Foundation Owner",
      emailVerified: true,
      createdAt: new Date(),
      updatedAt: new Date(),
      image: null,
      role
    },
    session: {
      id: `session_${role}`,
      userId: "user_foundation_owner",
      expiresAt: new Date(),
      token: `token_${role}`,
      createdAt: new Date(),
      updatedAt: new Date(),
      ipAddress: null,
      userAgent: null
    }
  } as unknown as NonNullable<Context["session"]>;
}

describe("command git router", () => {
  beforeEach(async () => {
    await resetSeededTestDatabase();
    delete process.env.APP_BASE_URL;
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.APP_BASE_URL;
  });

  it("exchanges GitLab codes with a form-encoded request and returns a sanitized summary", async () => {
    process.env.APP_BASE_URL = "https://demo.daoflow.dev/";

    const providerId = `gitprov_exchange_${Date.now()}`.slice(0, 32);
    await db.insert(gitProviders).values({
      id: providerId,
      type: "gitlab",
      name: `GitLab Exchange ${Date.now()}`,
      clientId: "gitlab-client-id",
      clientSecretEncrypted: encrypt("gitlab-client-secret"),
      baseUrl: "https://gitlab.example.com/",
      status: "active",
      updatedAt: new Date()
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);

      if (url === "https://gitlab.example.com/oauth/token") {
        expect(init?.method).toBe("POST");
        expect(new Headers(init?.headers).get("Content-Type")).toBe(
          "application/x-www-form-urlencoded"
        );

        const body = init?.body;
        const params = new URLSearchParams(
          body instanceof URLSearchParams ? body : typeof body === "string" ? body : ""
        );
        expect(Object.fromEntries(params.entries())).toEqual({
          client_id: "gitlab-client-id",
          client_secret: "gitlab-client-secret",
          code: "oauth-code",
          grant_type: "authorization_code",
          redirect_uri: "https://demo.daoflow.dev/settings/git/callback"
        });

        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "gl-access-token" }), {
            status: 200
          })
        );
      }

      if (url === "https://gitlab.example.com/api/v4/user") {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer gl-access-token");
        return Promise.resolve(
          new Response(JSON.stringify({ id: 703, username: "example-group" }), {
            status: 200
          })
        );
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const caller = appRouter.createCaller({
      requestId: "test-gitlab-code-exchange",
      session: makeSession("admin")
    });

    const installation = await caller.exchangeGitLabCode({
      code: "oauth-code",
      providerId
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(installation).toMatchObject({
      providerId,
      installationId: "703",
      accountName: "example-group",
      accountType: "user",
      repositorySelection: "all",
      status: "active"
    });
    expect(installation).not.toHaveProperty("permissions");

    const storedInstallations = await db
      .select()
      .from(gitInstallations)
      .where(eq(gitInstallations.providerId, providerId));

    expect(storedInstallations).toHaveLength(1);
    const [storedInstallation] = storedInstallations;
    expect(storedInstallation).toBeDefined();
    if (!storedInstallation) {
      throw new Error("Expected stored GitLab installation to exist.");
    }
    expect(readGitInstallationAccessToken(storedInstallation)).toBe("gl-access-token");
  });

  it("rejects GitLab code exchange when the provider is missing OAuth credentials", async () => {
    const providerId = `gitprov_missing_${Date.now()}`.slice(0, 32);
    await db.insert(gitProviders).values({
      id: providerId,
      type: "gitlab",
      name: `GitLab Missing Secret ${Date.now()}`,
      clientId: "gitlab-client-id",
      status: "active",
      updatedAt: new Date()
    });

    const fetchMock = vi.spyOn(globalThis, "fetch");
    const caller = appRouter.createCaller({
      requestId: "test-gitlab-missing-secret",
      session: makeSession("admin")
    });

    await expect(
      caller.exchangeGitLabCode({
        code: "oauth-code",
        providerId
      })
    ).rejects.toMatchObject({
      code: "BAD_REQUEST",
      message: "GitLab provider is missing a client secret"
    });

    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("surfaces GitLab user lookup failures before creating an installation", async () => {
    const providerId = `gitprov_lookup_${Date.now()}`.slice(0, 32);
    await db.insert(gitProviders).values({
      id: providerId,
      type: "gitlab",
      name: `GitLab Lookup ${Date.now()}`,
      clientId: "gitlab-client-id",
      clientSecretEncrypted: encrypt("gitlab-client-secret"),
      baseUrl: "https://gitlab.example.com",
      status: "active",
      updatedAt: new Date()
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input instanceof Request ? input.url : input);

      if (url === "https://gitlab.example.com/oauth/token") {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "gl-access-token" }), {
            status: 200
          })
        );
      }

      if (url === "https://gitlab.example.com/api/v4/user") {
        return Promise.resolve(new Response("unauthorized", { status: 401 }));
      }

      throw new Error(`Unexpected fetch URL: ${url}`);
    });

    const caller = appRouter.createCaller({
      requestId: "test-gitlab-user-lookup-failure",
      session: makeSession("admin")
    });

    await expect(
      caller.exchangeGitLabCode({
        code: "oauth-code",
        providerId
      })
    ).rejects.toMatchObject({
      code: "INTERNAL_SERVER_ERROR",
      message: "GitLab user lookup failed: unauthorized"
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);

    const storedInstallations = await db
      .select()
      .from(gitInstallations)
      .where(eq(gitInstallations.providerId, providerId));

    expect(storedInstallations).toHaveLength(0);
  });

  it("reuses an existing installation when the same callback is replayed", async () => {
    const providerId = `gitprov_replay_${Date.now()}`.slice(0, 32);
    await db.insert(gitProviders).values({
      id: providerId,
      type: "github",
      name: `GitHub Replay ${Date.now()}`,
      appId: "12345",
      status: "active",
      updatedAt: new Date()
    });

    const caller = appRouter.createCaller({
      requestId: "test-git-installation-replay",
      session: makeSession("admin")
    });

    const firstInstallation = await caller.createGitInstallation({
      providerId,
      installationId: "9001",
      accountName: "octo-org",
      accountType: "organization",
      repositorySelection: "selected",
      permissions: JSON.stringify({ access_token: "first-token" })
    });

    const replayedInstallation = await caller.createGitInstallation({
      providerId,
      installationId: "9001",
      accountName: "octo-renamed",
      accountType: "organization",
      repositorySelection: "all",
      permissions: JSON.stringify({ access_token: "second-token" })
    });

    expect(replayedInstallation.id).toBe(firstInstallation.id);
    expect(replayedInstallation).toMatchObject({
      providerId,
      installationId: "9001",
      accountName: "octo-renamed",
      repositorySelection: "all",
      status: "active"
    });

    const storedInstallations = await db
      .select()
      .from(gitInstallations)
      .where(eq(gitInstallations.providerId, providerId));

    expect(storedInstallations).toHaveLength(1);
    const [storedInstallation] = storedInstallations;
    expect(storedInstallation).toBeDefined();
    if (!storedInstallation) {
      throw new Error("Expected replayed Git installation to exist.");
    }

    expect(storedInstallation.id).toBe(firstInstallation.id);
    expect(storedInstallation.accountName).toBe("octo-renamed");
    expect(storedInstallation.repositorySelection).toBe("all");
    expect(readGitInstallationAccessToken(storedInstallation)).toBe("second-token");
  });
});
