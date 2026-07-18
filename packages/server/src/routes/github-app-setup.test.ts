import { generateKeyPairSync } from "node:crypto";
import { Hono } from "hono";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { encrypt } from "../db/crypto";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { teamMembers } from "../db/schema/teams";
import { db } from "../db/connection";
import { and, eq } from "drizzle-orm";
import { createGitProviderSetupState } from "../db/services/git-provider-setup-states";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import { createGitHubAppSetupHandler } from "./github-app-setup";

const ownerSession = {
  user: {
    id: "user_foundation_owner",
    email: "owner@daoflow.local",
    role: "owner"
  }
};

describe("GitHub App setup callback", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    process.env.APP_BASE_URL = "https://demo.daoflow.dev";
  });

  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.APP_BASE_URL;
  });

  it("consumes a team-owned state once and verifies the GitHub installation before storing it", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const providerId = "gitprov_callback_gh";
    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "github",
      name: "Callback GitHub",
      appId: "123456",
      clientId: "Iv1.callback-github",
      clientSecretEncrypted: encrypt("github-client-secret"),
      privateKeyEncrypted: encrypt(privateKey.export({ format: "pem", type: "pkcs1" }).toString()),
      status: "active",
      updatedAt: new Date()
    });
    const setup = await createGitProviderSetupState({
      teamId: "team_foundation",
      providerId,
      providerType: "github",
      action: "github_installation",
      callbackOrigin: "https://demo.daoflow.dev",
      initiatedByUserId: "user_foundation_owner"
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input, init) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://github.com/login/oauth/access_token") {
        const body = new URLSearchParams(typeof init?.body === "string" ? init.body : "");
        expect(body.get("client_id")).toBe("Iv1.callback-github");
        expect(body.get("client_secret")).toBe("github-client-secret");
        expect(body.get("code")).toBe("github-user-code");
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "github-user-token" }), { status: 200 })
        );
      }
      if (url === "https://api.github.com/user/installations/42/repositories?per_page=1") {
        expect(new Headers(init?.headers).get("Authorization")).toBe("Bearer github-user-token");
        return Promise.resolve(new Response(JSON.stringify({ total_count: 1 }), { status: 200 }));
      }
      if (url === "https://api.github.com/app/installations/42") {
        return Promise.resolve(
          new Response(
            JSON.stringify({
              account: { login: "example-org", type: "Organization" },
              repository_selection: "selected"
            }),
            { status: 200 }
          )
        );
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    const app = new Hono();
    app.get(
      "/setup",
      createGitHubAppSetupHandler({
        getSession: () => Promise.resolve(ownerSession as never)
      })
    );

    const response = await app.request(
      `/setup?state=${setup.id}&installation_id=42&setup_action=install&code=github-user-code`
    );
    expect(response.status).toBe(302);
    expect(response.headers.get("location")).toBe(
      "https://demo.daoflow.dev/settings?git_setup=installed"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);

    const installations = await db.select().from(gitInstallations);
    expect(installations).toEqual([
      expect.objectContaining({
        teamId: "team_foundation",
        providerId,
        installationId: "42",
        accountName: "example-org",
        repositorySelection: "selected"
      })
    ]);

    const replay = await app.request(
      `/setup?state=${setup.id}&installation_id=42&setup_action=install&code=github-user-code`
    );
    expect(replay.status).toBe(302);
    expect(replay.headers.get("location")).toBe(
      "https://demo.daoflow.dev/settings?git_error=invalid_setup_state"
    );
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });

  it("rejects a callback when the initiating user no longer belongs to the setup team", async () => {
    const providerId = "gitprov_callback_removed";
    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "github",
      name: "Removed Member GitHub",
      appId: "654321",
      privateKeyEncrypted: encrypt("unused-for-rejected-callback"),
      status: "active",
      updatedAt: new Date()
    });
    const setup = await createGitProviderSetupState({
      teamId: "team_foundation",
      providerId,
      providerType: "github",
      action: "github_installation",
      callbackOrigin: "https://demo.daoflow.dev",
      initiatedByUserId: "user_foundation_owner"
    });
    await db
      .delete(teamMembers)
      .where(
        and(
          eq(teamMembers.teamId, "team_foundation"),
          eq(teamMembers.userId, "user_foundation_owner")
        )
      );
    const fetchMock = vi.spyOn(globalThis, "fetch");
    const app = new Hono();
    app.get(
      "/setup",
      createGitHubAppSetupHandler({
        getSession: () => Promise.resolve(ownerSession as never)
      })
    );

    const response = await app.request(
      `/setup?state=${setup.id}&installation_id=42&setup_action=install&code=github-user-code`
    );
    expect(response.headers.get("location")).toBe(
      "https://demo.daoflow.dev/settings?git_error=invalid_setup_state"
    );
    expect(fetchMock).not.toHaveBeenCalled();
    expect(await db.select().from(gitInstallations)).toHaveLength(0);
  });

  it("rejects an installation that the GitHub user token cannot access", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const providerId = "gitprov_callback_unowned";
    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "github",
      name: "Unowned Installation GitHub",
      appId: "777777",
      clientId: "Iv1.unowned-github",
      clientSecretEncrypted: encrypt("github-client-secret"),
      privateKeyEncrypted: encrypt(privateKey.export({ format: "pem", type: "pkcs1" }).toString()),
      status: "active",
      updatedAt: new Date()
    });
    const setup = await createGitProviderSetupState({
      teamId: "team_foundation",
      providerId,
      providerType: "github",
      action: "github_installation",
      callbackOrigin: "https://demo.daoflow.dev",
      initiatedByUserId: "user_foundation_owner"
    });
    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementation((input) => {
      const url = String(input instanceof Request ? input.url : input);
      if (url === "https://github.com/login/oauth/access_token") {
        return Promise.resolve(
          new Response(JSON.stringify({ access_token: "github-user-token" }), { status: 200 })
        );
      }
      if (url === "https://api.github.com/user/installations/99/repositories?per_page=1") {
        return Promise.resolve(new Response("Not Found", { status: 404 }));
      }
      throw new Error(`Unexpected fetch URL: ${url}`);
    });
    const app = new Hono();
    app.get(
      "/setup",
      createGitHubAppSetupHandler({
        getSession: () => Promise.resolve(ownerSession as never)
      })
    );

    const response = await app.request(
      `/setup?state=${setup.id}&installation_id=99&setup_action=install&code=github-user-code`
    );

    expect(response.headers.get("location")).toBe(
      "https://demo.daoflow.dev/settings?git_error=installation_failed"
    );
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(await db.select().from(gitInstallations)).toHaveLength(0);
  });
});
