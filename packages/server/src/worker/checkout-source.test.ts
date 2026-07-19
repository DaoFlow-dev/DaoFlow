import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { db } from "../db/connection";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects, repositoryCredentials } from "../db/schema/projects";
import { teams } from "../db/schema/teams";
import { users } from "../db/schema/users";
import { encodeGitInstallationPermissions } from "../db/services/git-providers";
import { createGitLabCredentialStorage } from "../db/services/gitlab-credentials";
import { encrypt } from "../db/crypto";
import { resetTestDatabase } from "../test-db";
import { resolveCheckoutSpec } from "./checkout-source";

describe("resolveCheckoutSpec", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await db.insert(users).values({
      id: "user_foundation_owner",
      email: "owner@daoflow.local",
      name: "Foundation Owner",
      role: "owner",
      updatedAt: new Date()
    });
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

  it("returns a direct checkout spec for raw repository URLs", async () => {
    const spec = await resolveCheckoutSpec({
      repoUrl: "https://example.com/org/repo.git",
      repoFullName: "org/repo",
      branch: "main"
    });

    expect(spec).toEqual({
      repoUrl: "https://example.com/org/repo.git",
      branch: "main",
      displayLabel: "org/repo",
      gitConfig: [],
      repositoryPreparation: {
        submodules: false,
        gitLfs: false
      },
      requiresLocalMaterialization: false
    });
  });

  it("adds encrypted HTTPS token credentials to generic checkout specs", async () => {
    const projectId = `proj_${Date.now()}`.slice(0, 32);
    await db.insert(projects).values({
      id: projectId,
      name: `Private ${Date.now()}`,
      teamId: "team_foundation",
      repoUrl: "https://example.com/org/private.git",
      updatedAt: new Date()
    });
    await db.insert(repositoryCredentials).values({
      id: `repo_cred_${Date.now()}`.slice(0, 32),
      projectId,
      kind: "https_token",
      tokenEncrypted: encrypt("repo-token"),
      status: "active",
      updatedAt: new Date()
    });

    const spec = await resolveCheckoutSpec({
      projectId,
      repoUrl: "https://example.com/org/private.git",
      branch: "main"
    });

    expect(spec?.gitConfig).toEqual([
      { key: "http.extraHeader", value: "Authorization: Bearer repo-token" }
    ]);
    expect(spec?.repoUrl).toBe("https://example.com/org/private.git");
  });

  it("adds encrypted HTTPS basic credentials to generic checkout specs", async () => {
    const projectId = `proj_${Date.now()}`.slice(0, 32);
    await db.insert(projects).values({
      id: projectId,
      name: `Private Basic ${Date.now()}`,
      teamId: "team_foundation",
      repoUrl: "https://example.com/org/basic.git",
      updatedAt: new Date()
    });
    await db.insert(repositoryCredentials).values({
      id: `repo_cred_${Date.now()}`.slice(0, 32),
      projectId,
      kind: "https_basic",
      usernameEncrypted: encrypt("deploy"),
      passwordEncrypted: encrypt("repo-password"),
      status: "active",
      updatedAt: new Date()
    });

    const spec = await resolveCheckoutSpec({
      projectId,
      repoUrl: "https://example.com/org/basic.git",
      branch: "main"
    });

    expect(spec?.gitConfig).toEqual([
      {
        key: "http.extraHeader",
        value: `Authorization: Basic ${Buffer.from("deploy:repo-password").toString("base64")}`
      }
    ]);
    expect(spec?.repoUrl).toBe("https://example.com/org/basic.git");
  });

  it("adds encrypted SSH keys to generic checkout specs", async () => {
    const projectId = `proj_${Date.now()}`.slice(0, 32);
    const privateKey =
      "-----BEGIN OPENSSH PRIVATE KEY-----\nabc\n-----END OPENSSH PRIVATE KEY-----";
    await db.insert(projects).values({
      id: projectId,
      name: `Private SSH ${Date.now()}`,
      teamId: "team_foundation",
      repoUrl: "git@example.com:org/private.git",
      updatedAt: new Date()
    });
    await db.insert(repositoryCredentials).values({
      id: `repo_cred_${Date.now()}`.slice(0, 32),
      projectId,
      kind: "ssh_key",
      privateKeyEncrypted: encrypt(privateKey),
      status: "active",
      updatedAt: new Date()
    });

    const spec = await resolveCheckoutSpec({
      projectId,
      repoUrl: "git@example.com:org/private.git",
      branch: "main"
    });

    expect(spec?.gitConfig).toEqual([]);
    expect(spec?.sshPrivateKey).toBe(privateKey);
  });

  it("forces local materialization when repository preparation requires submodules or Git LFS", async () => {
    const spec = await resolveCheckoutSpec({
      repoUrl: "https://example.com/org/repo.git",
      branch: "main",
      repositoryPreparation: {
        submodules: true,
        gitLfs: true
      }
    });

    expect(spec).toEqual({
      repoUrl: "https://example.com/org/repo.git",
      branch: "main",
      displayLabel: "https://example.com/org/repo.git",
      gitConfig: [],
      repositoryPreparation: {
        submodules: true,
        gitLfs: true
      },
      requiresLocalMaterialization: true
    });
  });

  it("uses GitLab OAuth Basic auth for encrypted installation tokens", async () => {
    const providerId = `gitprov_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}`.slice(0, 32);

    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "gitlab",
      name: `GitLab Provider ${Date.now()}`,
      baseUrl: "https://gitlab.example.com",
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      teamId: "team_foundation",
      providerId,
      installationId: "54321",
      accountName: "example-group",
      accountType: "group",
      repositorySelection: "selected",
      permissions: encodeGitInstallationPermissions({ accessToken: "glpat-encrypted" }),
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    const spec = await resolveCheckoutSpec({
      teamId: "team_foundation",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      repoFullName: "example-group/platform",
      branch: "release"
    });

    expect(spec).toEqual({
      repoUrl: "https://gitlab.example.com/example-group/platform.git",
      branch: "release",
      displayLabel: "example-group/platform",
      gitConfig: [
        {
          key: "http.extraHeader",
          value: `Authorization: Basic ${Buffer.from("oauth2:glpat-encrypted").toString("base64")}`
        }
      ],
      repositoryPreparation: {
        submodules: false,
        gitLfs: false
      },
      requiresLocalMaterialization: true
    });
  });

  it("uses deploy-token Basic auth and the internal GitLab URL without API calls", async () => {
    const providerId = `gitprov_deploy_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_deploy_${Date.now()}`.slice(0, 32);
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "gitlab",
      name: `GitLab Deploy ${Date.now()}`,
      baseUrl: "https://gitlab.public.example.com/gitlab",
      internalBaseUrl: "https://gitlab.internal.example.com/gitlab",
      status: "active",
      updatedAt: new Date()
    });
    await db.insert(gitInstallations).values({
      id: installationId,
      teamId: "team_foundation",
      providerId,
      installationId: "deploy-1",
      accountName: "deploy-user",
      accountType: "deploy_token",
      repositorySelection: "all",
      ...createGitLabCredentialStorage({
        kind: "deploy_token",
        username: "deploy-user",
        token: "deploy-token"
      }),
      status: "active",
      updatedAt: new Date()
    });

    const spec = await resolveCheckoutSpec({
      teamId: "team_foundation",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      repoFullName: "example-group/platform",
      branch: "main"
    });

    expect(spec?.repoUrl).toBe(
      "https://gitlab.internal.example.com/gitlab/example-group/platform.git"
    );
    expect(spec?.gitConfig).toEqual([
      {
        key: "http.extraHeader",
        value: `Authorization: Basic ${Buffer.from("deploy-user:deploy-token").toString("base64")}`
      }
    ]);
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it("uses oauth2 Basic auth for GitLab API-token checkouts", async () => {
    const providerId = `gitprov_api_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_api_${Date.now()}`.slice(0, 32);
    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "gitlab",
      name: `GitLab API ${Date.now()}`,
      status: "active",
      updatedAt: new Date()
    });
    await db.insert(gitInstallations).values({
      id: installationId,
      teamId: "team_foundation",
      providerId,
      installationId: "api-1",
      accountName: "api-user",
      accountType: "user",
      repositorySelection: "all",
      ...createGitLabCredentialStorage({ kind: "api_token", token: "api-token" }),
      status: "active",
      updatedAt: new Date()
    });

    const spec = await resolveCheckoutSpec({
      teamId: "team_foundation",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      repoFullName: "example-group/platform",
      branch: "main"
    });

    expect(spec?.gitConfig).toEqual([
      {
        key: "http.extraHeader",
        value: `Authorization: Basic ${Buffer.from("oauth2:api-token").toString("base64")}`
      }
    ]);
  });

  it("rejects legacy plain-text GitLab installation tokens", async () => {
    const providerId = `gitprov_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}`.slice(0, 32);

    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "gitlab",
      name: `GitLab Legacy ${Date.now()}`,
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      teamId: "team_foundation",
      providerId,
      installationId: "67890",
      accountName: "legacy-group",
      accountType: "group",
      repositorySelection: "all",
      permissions: JSON.stringify({ access_token: "glpat-legacy" }),
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    await expect(
      resolveCheckoutSpec({
        teamId: "team_foundation",
        gitProviderId: providerId,
        gitInstallationId: installationId,
        repoFullName: "legacy-group/platform",
        branch: "main"
      })
    ).rejects.toThrow("does not have a usable access token");
  });

  it("mints a GitHub installation token and resolves a provider-backed checkout spec", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
    const providerId = `gitprov_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}`.slice(0, 32);

    await db.insert(gitProviders).values({
      id: providerId,
      teamId: "team_foundation",
      type: "github",
      name: `GitHub Provider ${Date.now()}`,
      appId: "123456",
      privateKeyEncrypted: encrypt(privateKeyPem),
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
      teamId: "team_foundation",
      providerId,
      installationId: "777",
      accountName: "example-org",
      accountType: "organization",
      repositorySelection: "selected",
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValue(
      new Response(JSON.stringify({ token: "ghs_installation_token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    );

    const spec = await resolveCheckoutSpec({
      teamId: "team_foundation",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      repoFullName: "example-org/platform",
      branch: "main"
    });

    const firstCall = fetchMock.mock.calls[0] as [string, RequestInit] | undefined;
    expect(firstCall?.[0]).toBe("https://api.github.com/app/installations/777/access_tokens");
    expect(firstCall?.[1].method).toBe("POST");
    const headers = firstCall?.[1].headers as Record<string, string> | undefined;
    expect(headers?.Accept).toBe("application/vnd.github+json");
    expect(headers?.Authorization).toMatch(/^Bearer /);
    expect(spec).toEqual({
      repoUrl: "https://github.com/example-org/platform.git",
      branch: "main",
      displayLabel: "example-org/platform",
      gitConfig: [
        {
          key: "http.extraHeader",
          value: `AUTHORIZATION: basic ${Buffer.from("x-access-token:ghs_installation_token").toString("base64")}`
        }
      ],
      repositoryPreparation: {
        submodules: false,
        gitLfs: false
      },
      requiresLocalMaterialization: true
    });
  });

  it("does not resolve another team's provider credential for a durable project", async () => {
    const projectId = `proj_team_scope_${Date.now()}`.slice(0, 32);
    const providerA = `gitprov_a_${Date.now()}`.slice(0, 32);
    const installationA = `gitinst_a_${Date.now()}`.slice(0, 32);
    const providerB = `gitprov_b_${Date.now()}`.slice(0, 32);
    const installationB = `gitinst_b_${Date.now()}`.slice(0, 32);

    await db.insert(teams).values({
      id: "team_checkout_b",
      name: "Checkout B",
      slug: "checkout-b",
      createdByUserId: "user_foundation_owner",
      updatedAt: new Date()
    });
    await db.insert(gitProviders).values([
      {
        id: providerA,
        teamId: "team_foundation",
        type: "gitlab",
        name: `Checkout A ${Date.now()}`,
        status: "active",
        updatedAt: new Date()
      },
      {
        id: providerB,
        teamId: "team_checkout_b",
        type: "gitlab",
        name: `Checkout B ${Date.now()}`,
        status: "active",
        updatedAt: new Date()
      }
    ]);
    await db.insert(gitInstallations).values([
      {
        id: installationA,
        teamId: "team_foundation",
        providerId: providerA,
        installationId: "a",
        accountName: "a",
        accountType: "group",
        repositorySelection: "all",
        permissions: encodeGitInstallationPermissions({ accessToken: "team-a-token" }),
        status: "active",
        updatedAt: new Date()
      },
      {
        id: installationB,
        teamId: "team_checkout_b",
        providerId: providerB,
        installationId: "b",
        accountName: "b",
        accountType: "group",
        repositorySelection: "all",
        permissions: encodeGitInstallationPermissions({ accessToken: "team-b-token" }),
        status: "active",
        updatedAt: new Date()
      }
    ]);
    await db.insert(projects).values({
      id: projectId,
      name: `Checkout Project ${Date.now()}`,
      teamId: "team_foundation",
      repoFullName: "team-a/private",
      gitProviderId: providerA,
      gitInstallationId: installationA,
      updatedAt: new Date()
    });

    await expect(
      resolveCheckoutSpec({
        projectId,
        teamId: "team_checkout_b",
        gitProviderId: providerB,
        gitInstallationId: installationB,
        repoFullName: "team-b/private"
      })
    ).rejects.toThrow("durable provider installation binding");
  });
});
