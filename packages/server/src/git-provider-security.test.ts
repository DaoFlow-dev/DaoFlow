import { beforeEach, describe, expect, it } from "vitest";
import { appRouter } from "./router";
import { resetTestDatabaseWithControlPlane } from "./test-db";
import { db } from "./db/connection";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { encrypt } from "./db/crypto";
import { makeSession } from "./testing/request-auth-fixtures";

describe("git provider security surfaces", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("returns sanitized git provider and installation summaries", async () => {
    const providerId = `gitprov_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}`.slice(0, 32);

    await db.insert(gitProviders).values({
      id: providerId,
      type: "gitlab",
      name: `GitLab ${Date.now()}`,
      clientId: "gitlab-client-id",
      clientSecretEncrypted: encrypt("gitlab-client-secret"),
      privateKeyEncrypted: encrypt("gitlab-private-key"),
      webhookSecret: "gitlab-webhook-secret",
      baseUrl: "https://gitlab.example.com",
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      providerId,
      installationId: "12345",
      accountName: "example-group",
      accountType: "group",
      repositorySelection: "selected",
      permissions: JSON.stringify({ access_token: "glpat-legacy" }),
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    const caller = appRouter.createCaller({
      requestId: "test-sanitized-git-summaries",
      session: makeSession("viewer")
    });

    const providers = await caller.gitProviders();
    const installations = await caller.gitInstallations({ providerId });

    expect(providers[0]).toMatchObject({
      id: providerId,
      type: "gitlab",
      clientId: "gitlab-client-id",
      baseUrl: "https://gitlab.example.com"
    });
    expect(providers[0]).not.toHaveProperty("clientSecretEncrypted");
    expect(providers[0]).not.toHaveProperty("privateKeyEncrypted");
    expect(providers[0]).not.toHaveProperty("webhookSecret");

    expect(installations[0]).toMatchObject({
      id: installationId,
      providerId,
      accountName: "example-group",
      repositorySelection: "selected"
    });
    expect(installations[0]).not.toHaveProperty("permissions");
  });

  it("returns sanitized provider and installation payloads from admin mutations", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-sanitized-git-mutations",
      session: makeSession("admin")
    });

    const provider = await caller.registerGitProvider({
      type: "gitlab",
      name: `Mutation Provider ${Date.now()}`,
      clientId: "gitlab-client-id",
      clientSecret: "gitlab-client-secret",
      webhookSecret: "gitlab-webhook-secret",
      baseUrl: "https://gitlab.example.com"
    });

    expect(provider).toMatchObject({
      type: "gitlab",
      clientId: "gitlab-client-id",
      baseUrl: "https://gitlab.example.com"
    });
    expect(provider).not.toHaveProperty("clientSecretEncrypted");
    expect(provider).not.toHaveProperty("webhookSecret");

    const installation = await caller.createGitInstallation({
      providerId: provider.id,
      installationId: `${Date.now()}`,
      accountName: "example-group",
      accountType: "group",
      repositorySelection: "all",
      permissions: JSON.stringify({ access_token: "glpat-manual" })
    });

    expect(installation).toMatchObject({
      providerId: provider.id,
      accountName: "example-group",
      repositorySelection: "all"
    });
    expect(installation).not.toHaveProperty("permissions");
  });
});
