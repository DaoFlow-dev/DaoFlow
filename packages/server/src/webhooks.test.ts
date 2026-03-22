import { createHmac, generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { db } from "./db/connection";
import { encrypt } from "./db/crypto";
import { deployments } from "./db/schema/deployments";
import { createEnvironment, createProject } from "./db/services/projects";
import { encodeGitInstallationPermissions } from "./db/services/git-providers";
import { createService } from "./db/services/services";
import { auditEntries } from "./db/schema/audit";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { projects } from "./db/schema/projects";
import { resetTestDatabaseWithControlPlane } from "./test-db";

function toRequestUrl(input: string | URL | Request): string {
  if (typeof input === "string") {
    return input;
  }

  if (input instanceof URL) {
    return input.toString();
  }

  return input.url;
}

function mockGitHubSourceFetch(input: {
  repoFullName: string;
  installationId: string;
  branch?: string;
  composePath?: string;
}) {
  const branch = input.branch ?? "main";
  const composePath = input.composePath ?? "docker-compose.yml";
  const encodedComposePath = encodeURIComponent(composePath);

  return (request: string | URL | Request) => {
    const url = toRequestUrl(request);

    if (url.endsWith(`/app/installations/${input.installationId}/access_tokens`)) {
      return Promise.resolve(
        new Response(JSON.stringify({ token: "ghs_webhook_validation" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }

    if (url.endsWith(`/repos/${input.repoFullName}`)) {
      return Promise.resolve(new Response(JSON.stringify({ id: 1 }), { status: 200 }));
    }

    if (url.endsWith(`/repos/${input.repoFullName}/branches/${encodeURIComponent(branch)}`)) {
      return Promise.resolve(new Response(JSON.stringify({ name: branch }), { status: 200 }));
    }

    if (
      url.includes(
        `/repos/${input.repoFullName}/contents/${encodedComposePath}?ref=${encodeURIComponent(branch)}`
      )
    ) {
      return Promise.resolve(new Response(JSON.stringify({ path: composePath }), { status: 200 }));
    }

    throw new Error(`Unexpected fetch request: ${url}`);
  };
}

function mockGitLabSourceFetch(input: {
  repoFullName: string;
  branch?: string;
  composePath?: string;
  projectId: number;
}) {
  const branch = input.branch ?? "main";
  const composePath = input.composePath ?? "docker-compose.yml";
  const encodedRepoFullName = encodeURIComponent(input.repoFullName);
  const encodedProjectId = encodeURIComponent(String(input.projectId));
  const encodedBranch = encodeURIComponent(branch);
  const encodedComposePath = encodeURIComponent(composePath);

  return (request: string | URL | Request) => {
    const url = toRequestUrl(request);

    if (url.endsWith(`/projects/${encodedRepoFullName}`)) {
      return Promise.resolve(
        new Response(JSON.stringify({ id: input.projectId }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }

    if (url.endsWith(`/projects/${encodedProjectId}/repository/branches/${encodedBranch}`)) {
      return Promise.resolve(new Response(JSON.stringify({ name: branch }), { status: 200 }));
    }

    if (
      url.includes(
        `/projects/${encodedProjectId}/repository/files/${encodedComposePath}?ref=${encodedBranch}`
      )
    ) {
      return Promise.resolve(
        new Response(JSON.stringify({ file_path: composePath }), { status: 200 })
      );
    }

    throw new Error(`Unexpected fetch request: ${url}`);
  };
}

async function createGitHubComposeWebhookFixture(input: {
  suffix: string;
  repoFullName: string;
  serviceName: string;
  externalInstallationId: string;
  webhookSecret: string;
  autoDeployBranch?: string;
  watchedPaths?: string[];
}) {
  const { privateKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
  const privateKeyPem = privateKey.export({ format: "pem", type: "pkcs1" }).toString();
  const providerId = `gitprov_gh_${input.suffix}`.slice(0, 32);
  const installationId = `gitinst_gh_${input.suffix}`.slice(0, 32);
  const projectResult = await createProject({
    name: `GitHub Webhook ${input.suffix}`,
    repoUrl: `https://github.com/${input.repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create GitHub webhook project fixture.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: "production",
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(environmentResult.status).toBe("ok");
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create GitHub webhook environment fixture.");
  }

  const serviceResult = await createService({
    name: input.serviceName,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(serviceResult.status).toBe("ok");
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create GitHub webhook service fixture.");
  }

  await db.insert(gitProviders).values({
    id: providerId,
    type: "github",
    name: `GitHub Webhook ${input.suffix}`,
    appId: `app-${input.suffix}`.slice(0, 40),
    privateKeyEncrypted: encrypt(privateKeyPem),
    webhookSecret: input.webhookSecret,
    status: "active",
    updatedAt: new Date()
  });

  await db.insert(gitInstallations).values({
    id: installationId,
    providerId,
    installationId: input.externalInstallationId,
    accountName: "example",
    accountType: "organization",
    repositorySelection: "selected",
    status: "active",
    installedByUserId: "user_foundation_owner",
    updatedAt: new Date()
  });

  const config =
    projectResult.project.config && typeof projectResult.project.config === "object"
      ? (projectResult.project.config as Record<string, unknown>)
      : {};

  await db
    .update(projects)
    .set({
      repoFullName: input.repoFullName,
      sourceType: "compose",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      autoDeploy: true,
      autoDeployBranch: input.autoDeployBranch ?? "main",
      defaultBranch: "main",
      config:
        input.watchedPaths && input.watchedPaths.length > 0
          ? {
              ...config,
              webhookAutoDeploy: {
                watchedPaths: input.watchedPaths
              }
            }
          : config,
      updatedAt: new Date()
    })
    .where(eq(projects.id, projectResult.project.id));

  return {
    projectId: projectResult.project.id,
    providerId,
    installationId,
    externalInstallationId: input.externalInstallationId,
    serviceName: input.serviceName
  };
}

async function createGitLabComposeWebhookFixture(input: {
  suffix: string;
  repoFullName: string;
  serviceName: string;
  webhookSecret: string;
  autoDeployBranch?: string;
  watchedPaths?: string[];
  projectApiId: number;
}) {
  const providerId = `gitprov_gl_${input.suffix}`.slice(0, 32);
  const installationId = `gitinst_gl_${input.suffix}`.slice(0, 32);
  const projectResult = await createProject({
    name: `GitLab Webhook ${input.suffix}`,
    repoUrl: `https://gitlab.com/${input.repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create GitLab webhook project fixture.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: "production",
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(environmentResult.status).toBe("ok");
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create GitLab webhook environment fixture.");
  }

  const serviceResult = await createService({
    name: input.serviceName,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType: "compose",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(serviceResult.status).toBe("ok");
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create GitLab webhook service fixture.");
  }

  await db.insert(gitProviders).values({
    id: providerId,
    type: "gitlab",
    name: `GitLab Webhook ${input.suffix}`,
    webhookSecret: input.webhookSecret,
    status: "active",
    updatedAt: new Date()
  });

  await db.insert(gitInstallations).values({
    id: installationId,
    providerId,
    installationId: String(input.projectApiId),
    accountName: "example",
    accountType: "group",
    repositorySelection: "all",
    permissions: encodeGitInstallationPermissions({ accessToken: `glpat-${input.suffix}` }),
    status: "active",
    installedByUserId: "user_foundation_owner",
    updatedAt: new Date()
  });

  const config =
    projectResult.project.config && typeof projectResult.project.config === "object"
      ? (projectResult.project.config as Record<string, unknown>)
      : {};

  await db
    .update(projects)
    .set({
      repoFullName: input.repoFullName,
      sourceType: "compose",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      autoDeploy: true,
      autoDeployBranch: input.autoDeployBranch ?? "main",
      defaultBranch: "main",
      config:
        input.watchedPaths && input.watchedPaths.length > 0
          ? {
              ...config,
              webhookAutoDeploy: {
                watchedPaths: input.watchedPaths
              }
            }
          : config,
      updatedAt: new Date()
    })
    .where(eq(projects.id, projectResult.project.id));

  return {
    projectId: projectResult.project.id,
    providerId,
    installationId,
    serviceName: input.serviceName
  };
}

describe("webhook routes", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("deduplicates repeated GitHub deliveries by delivery id", async () => {
    const fixture = await createGitHubComposeWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/dedupe-app",
      serviceName: "dedupe-runtime",
      externalInstallationId: "810",
      webhookSecret: "github-dedupe-secret"
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitHubSourceFetch({
        repoFullName: "example/dedupe-app",
        installationId: fixture.externalInstallationId
      })
    );

    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
      repository: { full_name: "example/dedupe-app" },
      installation: { id: Number(fixture.externalInstallationId) },
      sender: { login: "octocat" }
    });
    const signature =
      "sha256=" + createHmac("sha256", "github-dedupe-secret").update(payload).digest("hex");
    const app = createApp();

    const first = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-GitHub-Delivery": "gh-delivery-1",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    const second = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-GitHub-Delivery": "gh-delivery-1",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });

    const firstBody = (await first.json()) as { ok: boolean; deployments: number };
    const secondBody = (await second.json()) as {
      ok: boolean;
      skipped?: boolean;
      reason?: string;
      deployments?: number;
    };

    expect(first.status).toBe(200);
    expect(firstBody).toMatchObject({ ok: true, deployments: 1 });
    expect(second.status).toBe(200);
    expect(secondBody).toMatchObject({
      ok: true,
      skipped: true,
      reason: "duplicate delivery"
    });

    const queued = await db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceName, fixture.serviceName));
    expect(queued).toHaveLength(1);
  });

  it("ignores GitHub deliveries that do not match the configured branch and records audit evidence", async () => {
    const fixture = await createGitHubComposeWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/branch-filter-app",
      serviceName: "branch-filter-runtime",
      externalInstallationId: "811",
      webhookSecret: "github-branch-secret",
      autoDeployBranch: "release"
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitHubSourceFetch({
        repoFullName: "example/branch-filter-app",
        installationId: fixture.externalInstallationId,
        branch: "release"
      })
    );

    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "bbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbbb",
      repository: { full_name: "example/branch-filter-app" },
      installation: { id: Number(fixture.externalInstallationId) },
      sender: { login: "octocat" }
    });
    const signature =
      "sha256=" + createHmac("sha256", "github-branch-secret").update(payload).digest("hex");

    const app = createApp();
    const response = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-GitHub-Delivery": "gh-delivery-branch-ignore",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    const body = (await response.json()) as {
      ok: boolean;
      deployments: number;
      ignoredTargets?: number;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      deployments: 0,
      ignoredTargets: 1
    });

    const queued = await db.select().from(auditEntries);
    expect(
      queued.some(
        (entry) =>
          entry.targetResource === "webhook/github/example/branch-filter-app" &&
          entry.inputSummary?.includes("ignored") === true
      )
    ).toBe(true);

    const queuedDeployments = await db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceName, fixture.serviceName));
    expect(queuedDeployments).toHaveLength(0);
  });

  it("ignores GitLab deliveries when changed paths do not match watched path filters", async () => {
    const fixture = await createGitLabComposeWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/path-filter-app",
      serviceName: "path-filter-runtime",
      webhookSecret: "gitlab-path-secret",
      watchedPaths: ["deploy/**", "ops/*.yaml"],
      projectApiId: 812
    });

    vi.spyOn(globalThis, "fetch").mockImplementation(
      mockGitLabSourceFetch({
        repoFullName: "example/path-filter-app",
        projectId: 812
      })
    );

    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "cccccccccccccccccccccccccccccccccccccccc",
      checkout_sha: "cccccccccccccccccccccccccccccccccccccccc",
      project: {
        id: 812,
        path_with_namespace: "example/path-filter-app"
      },
      commits: [
        {
          id: "commit-1",
          added: ["README.md"],
          modified: ["docs/guide.md"],
          removed: []
        }
      ],
      user_name: "gitlab-bot"
    });

    const app = createApp();
    const response = await app.request("/api/webhooks/gitlab", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitLab-Token": "gitlab-path-secret",
        "X-GitLab-Event-UUID": "gitlab-event-path-ignore"
      },
      body: payload
    });
    const body = (await response.json()) as {
      ok: boolean;
      deployments: number;
      ignoredTargets?: number;
    };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({
      ok: true,
      deployments: 0,
      ignoredTargets: 1
    });

    const queuedDeployments = await db
      .select()
      .from(deployments)
      .where(eq(deployments.serviceName, fixture.serviceName));
    expect(queuedDeployments).toHaveLength(0);
  });

  it("uses GitHub installation metadata to avoid cross-provider repo collisions", async () => {
    const sharedRepoFullName = "example/shared-installation-app";
    const githubFixture = await createGitHubComposeWebhookFixture({
      suffix: `${Date.now()}a`,
      repoFullName: sharedRepoFullName,
      serviceName: "github-a-runtime",
      externalInstallationId: "813",
      webhookSecret: "github-install-a-secret"
    });
    const otherFixture = await createGitHubComposeWebhookFixture({
      suffix: `${Date.now()}b`,
      repoFullName: sharedRepoFullName,
      serviceName: "github-b-runtime",
      externalInstallationId: "814",
      webhookSecret: "github-install-b-secret"
    });

    const githubFetch = mockGitHubSourceFetch({
      repoFullName: sharedRepoFullName,
      installationId: githubFixture.externalInstallationId
    });
    const otherFetch = mockGitHubSourceFetch({
      repoFullName: sharedRepoFullName,
      installationId: otherFixture.externalInstallationId
    });

    vi.spyOn(globalThis, "fetch").mockImplementation((request) => {
      const url = toRequestUrl(request);
      if (url.includes(`/app/installations/${githubFixture.externalInstallationId}/`)) {
        return githubFetch(request);
      }
      if (url.includes(`/app/installations/${otherFixture.externalInstallationId}/`)) {
        return otherFetch(request);
      }
      if (url.startsWith("https://api.github.com/repos/")) {
        return githubFetch(request);
      }
      throw new Error(`Unexpected fetch request: ${url}`);
    });

    const payload = JSON.stringify({
      ref: "refs/heads/main",
      after: "dddddddddddddddddddddddddddddddddddddddd",
      repository: { full_name: sharedRepoFullName },
      installation: { id: Number(githubFixture.externalInstallationId) },
      sender: { login: "octocat" }
    });
    const signature =
      "sha256=" + createHmac("sha256", "github-install-a-secret").update(payload).digest("hex");

    const app = createApp();
    const response = await app.request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "push",
        "X-GitHub-Delivery": "gh-delivery-installation-aware",
        "X-Hub-Signature-256": signature
      },
      body: payload
    });
    const body = (await response.json()) as { ok: boolean; deployments: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, deployments: 1 });

    const githubDeployments = await db
      .select()
      .from(deployments)
      .where(eq(deployments.commitSha, "dddddddddddddddddddddddddddddddddddddddd"));
    expect(githubDeployments).toHaveLength(1);
    expect(githubDeployments[0]?.serviceName).toBe(githubFixture.serviceName);
  });
});
