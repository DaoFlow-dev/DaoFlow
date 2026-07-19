import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { db } from "./db/connection";
import { deployments } from "./db/schema/deployments";
import { auditEntries } from "./db/schema/audit";
import {
  createGitHubComposeWebhookFixture,
  createGitLabComposeWebhookFixture,
  mockGitHubSourceFetch,
  mockGitLabSourceFetch,
  toRequestUrl
} from "./testing/webhook-fixtures";
import { resetTestDatabaseWithControlPlane } from "./test-db";

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
