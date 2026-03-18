import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { generateKeyPairSync } from "node:crypto";
import { db } from "../db/connection";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { encodeGitInstallationPermissions } from "../db/services/git-providers";
import { encrypt } from "../db/crypto";
import { resetTestDatabase } from "../test-db";
import { ensureControlPlaneReady, resetControlPlaneSeedState } from "../db/services/seed";
import { resolveCheckoutSpec } from "./checkout-source";

describe("resolveCheckoutSpec", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    resetControlPlaneSeedState();
    await ensureControlPlaneReady();
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
      requiresLocalMaterialization: false
    });
  });

  it("resolves encrypted GitLab installation tokens into header-based checkout", async () => {
    const providerId = `gitprov_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}`.slice(0, 32);

    await db.insert(gitProviders).values({
      id: providerId,
      type: "gitlab",
      name: `GitLab Provider ${Date.now()}`,
      baseUrl: "https://gitlab.example.com",
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
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
      gitProviderId: providerId,
      gitInstallationId: installationId,
      repoFullName: "example-group/platform",
      branch: "release"
    });

    expect(spec).toEqual({
      repoUrl: "https://gitlab.example.com/example-group/platform.git",
      branch: "release",
      displayLabel: "example-group/platform",
      gitConfig: [{ key: "http.extraHeader", value: "Authorization: Bearer glpat-encrypted" }],
      requiresLocalMaterialization: true
    });
  });

  it("supports legacy plain-text GitLab installation tokens while migrating new writes to encrypted storage", async () => {
    const providerId = `gitprov_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}`.slice(0, 32);

    await db.insert(gitProviders).values({
      id: providerId,
      type: "gitlab",
      name: `GitLab Legacy ${Date.now()}`,
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
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

    const spec = await resolveCheckoutSpec({
      gitProviderId: providerId,
      gitInstallationId: installationId,
      repoFullName: "legacy-group/platform",
      branch: "main"
    });

    expect(spec?.gitConfig).toEqual([
      { key: "http.extraHeader", value: "Authorization: Bearer glpat-legacy" }
    ]);
  });

  it("mints a GitHub installation token and resolves a provider-backed checkout spec", async () => {
    const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
    const providerId = `gitprov_${Date.now()}`.slice(0, 32);
    const installationId = `gitinst_${Date.now()}`.slice(0, 32);

    await db.insert(gitProviders).values({
      id: providerId,
      type: "github",
      name: `GitHub Provider ${Date.now()}`,
      appId: "123456",
      privateKeyEncrypted: encrypt(privateKeyPem),
      status: "active",
      updatedAt: new Date()
    });

    await db.insert(gitInstallations).values({
      id: installationId,
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
      requiresLocalMaterialization: true
    });
  });
});
