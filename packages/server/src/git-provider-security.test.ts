import { beforeEach, describe, expect, it } from "vitest";
import { eq } from "drizzle-orm";
import { appRouter } from "./router";
import { resetTestDatabaseWithControlPlane } from "./test-db";
import { db } from "./db/connection";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { teams, teamMembers } from "./db/schema/teams";
import { users } from "./db/schema/users";
import { encrypt } from "./db/crypto";
import { createProject } from "./db/services/projects";
import { encodeGitInstallationPermissions } from "./db/services/git-providers";
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
      teamId: "team_foundation",
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
      teamId: "team_foundation",
      providerId,
      installationId: "12345",
      accountName: "example-group",
      accountType: "group",
      repositorySelection: "selected",
      permissions: encodeGitInstallationPermissions({ accessToken: "glpat-sanitized" }),
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

  it("returns a sanitized provider payload from the admin mutation", async () => {
    const caller = appRouter.createCaller({
      requestId: "test-sanitized-git-mutations",
      session: makeSession("admin")
    });

    const provider = await caller.registerGitProvider({
      type: "github",
      name: `Mutation Provider ${Date.now()}`,
      appId: "12345",
      clientId: "github-client-id",
      privateKey: "github-private-key",
      webhookSecret: "github-webhook-secret"
    });

    expect(provider).toMatchObject({
      type: "github",
      clientId: "github-client-id"
    });
    expect(provider).not.toHaveProperty("clientSecretEncrypted");
    expect(provider).not.toHaveProperty("webhookSecret");
  });

  it("returns not found across teams for listings, installation writes, and project bindings", async () => {
    const providerA = "gitprov_team_a";
    const installationA = "gitinst_team_a";
    const providerB = "gitprov_team_b";
    const installationB = "gitinst_team_b";

    await db.insert(teams).values({
      id: "team_scm_b",
      name: "SCM Team B",
      slug: "scm-team-b",
      createdByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });
    await db.insert(teamMembers).values({
      teamId: "team_scm_b",
      userId: "user_foundation_owner",
      role: "owner"
    });
    await db
      .update(users)
      .set({ defaultTeamId: "team_scm_b", updatedAt: new Date() })
      .where(eq(users.id, "user_foundation_owner"));

    await db.insert(gitProviders).values([
      {
        id: providerA,
        teamId: "team_foundation",
        type: "gitlab",
        name: "Team A GitLab",
        status: "active",
        updatedAt: new Date()
      },
      {
        id: providerB,
        teamId: "team_scm_b",
        type: "gitlab",
        name: "Team B GitLab",
        status: "active",
        updatedAt: new Date()
      }
    ]);
    await db.insert(gitInstallations).values([
      {
        id: installationA,
        teamId: "team_foundation",
        providerId: providerA,
        installationId: "team-a",
        accountName: "team-a",
        accountType: "group",
        repositorySelection: "all",
        status: "active",
        updatedAt: new Date()
      },
      {
        id: installationB,
        teamId: "team_scm_b",
        providerId: providerB,
        installationId: "team-b",
        accountName: "team-b",
        accountType: "group",
        repositorySelection: "all",
        status: "active",
        updatedAt: new Date()
      }
    ]);

    const caller = appRouter.createCaller({
      requestId: "test-team-scoped-git-surfaces",
      session: makeSession("admin")
    });
    await expect(caller.gitProviders()).resolves.toEqual([
      expect.objectContaining({ id: providerB })
    ]);
    await expect(caller.gitInstallations({ providerId: providerA })).resolves.toEqual([]);
    expect("createGitInstallation" in caller).toBe(false);

    const binding = await createProject({
      name: `Cross team binding ${Date.now()}`,
      teamId: "team_foundation",
      repoFullName: "team-b/private-repo",
      gitProviderId: providerB,
      gitInstallationId: installationB,
      requestedByUserId: "user_foundation_owner",
      requestedByEmail: "owner@daoflow.local",
      requestedByRole: "owner"
    });
    expect(binding).toMatchObject({ status: "not_found" });
  });
});
