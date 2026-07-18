import { createHmac, generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { db } from "./db/connection";
import { encrypt } from "./db/crypto";
import { developmentTaskComments, developmentTasks } from "./db/schema/development-tasks";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { projects } from "./db/schema/projects";
import { createProject } from "./db/services/projects";
import { resetTestDatabaseWithControlPlane } from "./test-db";

function signGitHubPayload(secret: string, payload: string) {
  return `sha256=${createHmac("sha256", secret).update(payload).digest("hex")}`;
}

async function createDevelopmentTaskWebhookFixture(input: {
  suffix: string;
  repoFullName: string;
  webhookSecret: string;
  externalInstallationId: string;
  githubAppCredentials?: boolean;
}) {
  const providerId = `gitprov_dev_${input.suffix}`.slice(0, 32);
  const installationId = `gitinst_dev_${input.suffix}`.slice(0, 32);
  const projectResult = await createProject({
    name: `Development Task Webhook ${input.suffix}`,
    repoUrl: `https://github.com/${input.repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });

  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create development task webhook project fixture.");
  }

  const privateKeyPem = input.githubAppCredentials
    ? generateKeyPairSync("rsa", { modulusLength: 2048 })
        .privateKey.export({ format: "pem", type: "pkcs1" })
        .toString()
    : null;

  await db.insert(gitProviders).values({
    id: providerId,
    teamId: "team_foundation",
    type: "github",
    name: `GitHub Development Task ${input.suffix}`,
    appId: input.githubAppCredentials ? "123456" : null,
    privateKeyEncrypted: privateKeyPem ? encrypt(privateKeyPem) : null,
    webhookSecret: input.webhookSecret,
    status: "active",
    updatedAt: new Date()
  });

  await db.insert(gitInstallations).values({
    id: installationId,
    teamId: "team_foundation",
    providerId,
    installationId: input.externalInstallationId,
    accountName: "example",
    accountType: "organization",
    repositorySelection: "selected",
    status: "active",
    installedByUserId: "user_foundation_owner",
    updatedAt: new Date()
  });

  await db
    .update(projects)
    .set({
      repoFullName: input.repoFullName,
      sourceType: "compose",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      autoDeploy: false,
      defaultBranch: "main",
      updatedAt: new Date()
    })
    .where(eq(projects.id, projectResult.project.id));

  return {
    projectId: projectResult.project.id,
    externalInstallationId: input.externalInstallationId
  };
}

function mockGitHubActorAuthorization(actor: string, permission = "write") {
  return vi
    .spyOn(globalThis, "fetch")
    .mockResolvedValueOnce(
      new Response(JSON.stringify({ token: "ghs_installation_token" }), {
        status: 200,
        headers: { "Content-Type": "application/json" }
      })
    )
    .mockImplementationOnce((url) => {
      expect(requestUrl(url)).toContain(`/collaborators/${actor}/permission`);
      return Promise.resolve(
        new Response(JSON.stringify({ permission }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    });
}

function requestUrl(url: unknown) {
  if (typeof url === "string") return url;
  if (url instanceof URL) return url.href;
  if (url instanceof Request) return url.url;
  return "";
}

describe("GitHub development task webhooks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.APP_BASE_URL;
  });

  it("queues a development task from a daoflow:run issue label without requiring auto-deploy", async () => {
    await resetTestDatabaseWithControlPlane();
    const fixture = await createDevelopmentTaskWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/dev-task-label",
      webhookSecret: "github-dev-task-label-secret",
      externalInstallationId: "9101",
      githubAppCredentials: true
    });
    mockGitHubActorAuthorization("octocat");

    const payload = JSON.stringify({
      action: "labeled",
      label: { name: "daoflow:run" },
      issue: {
        id: 185001,
        number: 185,
        html_url: "https://github.com/example/dev-task-label/issues/185",
        title: "Build the agent task runner",
        user: { login: "issue-author" },
        labels: [{ name: "daoflow:run" }]
      },
      repository: { full_name: "example/dev-task-label" },
      installation: { id: Number(fixture.externalInstallationId) },
      sender: { login: "octocat" }
    });

    const response = await createApp().request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "issues",
        "X-GitHub-Delivery": "gh-dev-task-label",
        "X-Hub-Signature-256": signGitHubPayload("github-dev-task-label-secret", payload)
      },
      body: payload
    });
    const body = (await response.json()) as { ok: boolean; tasksQueued?: number };

    expect(response.status).toBe(200);
    expect(body).toMatchObject({ ok: true, tasksQueued: 1 });

    const rows = await db
      .select()
      .from(developmentTasks)
      .where(eq(developmentTasks.repoFullName, "example/dev-task-label"));
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      projectId: fixture.projectId,
      providerType: "github",
      issueNumber: 185,
      issueTitle: "Build the agent task runner",
      requestedByExternalUser: "octocat",
      status: "queued"
    });
  });

  it("posts a durable queued status comment for accepted issue label deliveries", async () => {
    await resetTestDatabaseWithControlPlane();
    process.env.APP_BASE_URL = "https://daoflow.example.test/";
    const fixture = await createDevelopmentTaskWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/dev-task-status-comment",
      webhookSecret: "github-dev-task-status-secret",
      externalInstallationId: "9105",
      githubAppCredentials: true
    });
    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "ghs_installation_token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockImplementationOnce((url) => {
        expect(requestUrl(url)).toContain("/collaborators/octocat/permission");
        return Promise.resolve(
          new Response(JSON.stringify({ permission: "write" }), {
            status: 200,
            headers: { "Content-Type": "application/json" }
          })
        );
      })
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "ghs_installation_token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockImplementationOnce((_url, init) => {
        const rawBody = init?.body;
        if (typeof rawBody !== "string") {
          throw new Error("Expected GitHub issue comment request body to be a string.");
        }
        const body = JSON.parse(rawBody) as { body?: string };
        expect(body.body).toContain("DaoFlow accepted this task.");
        expect(body.body).toContain("Status: queued");
        expect(body.body).toContain("Project: Development Task Webhook");
        expect(body.body).toContain("Run: https://daoflow.example.test/development-tasks/");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 990001,
              html_url:
                "https://github.com/example/dev-task-status-comment/issues/189#issuecomment-990001"
            }),
            {
              status: 201,
              headers: { "Content-Type": "application/json" }
            }
          )
        );
      });

    const payload = JSON.stringify({
      action: "labeled",
      label: { name: "daoflow:run" },
      issue: {
        id: 185005,
        number: 189,
        html_url: "https://github.com/example/dev-task-status-comment/issues/189",
        title: "Post status comment",
        user: { login: "issue-author" },
        labels: [{ name: "daoflow:run" }]
      },
      repository: { full_name: "example/dev-task-status-comment" },
      installation: { id: Number(fixture.externalInstallationId) },
      sender: { login: "octocat" }
    });

    const response = await createApp().request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "issues",
        "X-GitHub-Delivery": "gh-dev-task-status-comment",
        "X-Hub-Signature-256": signGitHubPayload("github-dev-task-status-secret", payload)
      },
      body: payload
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, tasksQueued: 1 });

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://api.github.com/app/installations/9105/access_tokens"
    );
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.github.com/repos/example/dev-task-status-comment/collaborators/octocat/permission"
    );
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://api.github.com/app/installations/9105/access_tokens"
    );
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://api.github.com/repos/example/dev-task-status-comment/issues/189/comments"
    );
    expect((fetchMock.mock.calls[3]?.[1]?.headers as Record<string, string>).Authorization).toBe(
      "Bearer ghs_installation_token"
    );

    const [task] = await db
      .select()
      .from(developmentTasks)
      .where(eq(developmentTasks.repoFullName, "example/dev-task-status-comment"));
    const comments = await db
      .select()
      .from(developmentTaskComments)
      .where(eq(developmentTaskComments.externalCommentId, "990001"));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      taskId: task.id,
      providerType: "github",
      commentKind: "status"
    });
    expect(comments[0].lastBodyHash).toMatch(/^[a-f0-9]{64}$/);
    expect(comments[0].metadata).toMatchObject({
      status: "queued",
      commentUrl:
        "https://github.com/example/dev-task-status-comment/issues/189#issuecomment-990001"
    });
  });

  it("deduplicates repeated issue label deliveries", async () => {
    await resetTestDatabaseWithControlPlane();
    const fixture = await createDevelopmentTaskWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/dev-task-dedupe",
      webhookSecret: "github-dev-task-dedupe-secret",
      externalInstallationId: "9102",
      githubAppCredentials: true
    });
    mockGitHubActorAuthorization("octocat");

    const payload = JSON.stringify({
      action: "labeled",
      label: { name: "daoflow:run" },
      issue: {
        id: 185002,
        number: 186,
        html_url: "https://github.com/example/dev-task-dedupe/issues/186",
        title: "Deduplicate task triggers",
        user: { login: "issue-author" },
        labels: [{ name: "daoflow:run" }]
      },
      repository: { full_name: "example/dev-task-dedupe" },
      installation: { id: Number(fixture.externalInstallationId) },
      sender: { login: "octocat" }
    });
    const headers = {
      "Content-Type": "application/json",
      "X-GitHub-Event": "issues",
      "X-GitHub-Delivery": "gh-dev-task-dedupe",
      "X-Hub-Signature-256": signGitHubPayload("github-dev-task-dedupe-secret", payload)
    };

    const app = createApp();
    const first = await app.request("/api/webhooks/github", {
      method: "POST",
      headers,
      body: payload
    });
    const second = await app.request("/api/webhooks/github", {
      method: "POST",
      headers,
      body: payload
    });

    expect(first.status).toBe(200);
    expect(second.status).toBe(200);
    expect(await second.json()).toMatchObject({
      ok: true,
      skipped: true,
      reason: "duplicate delivery"
    });

    const rows = await db
      .select()
      .from(developmentTasks)
      .where(eq(developmentTasks.repoFullName, "example/dev-task-dedupe"));
    expect(rows).toHaveLength(1);
  });

  it("ignores matching issue label deliveries for inactive projects", async () => {
    await resetTestDatabaseWithControlPlane();
    const fixture = await createDevelopmentTaskWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/dev-task-inactive",
      webhookSecret: "github-dev-task-inactive-secret",
      externalInstallationId: "9104"
    });

    await db
      .update(projects)
      .set({ status: "paused", updatedAt: new Date() })
      .where(eq(projects.id, fixture.projectId));

    const payload = JSON.stringify({
      action: "labeled",
      label: { name: "daoflow:run" },
      issue: {
        id: 185004,
        number: 188,
        html_url: "https://github.com/example/dev-task-inactive/issues/188",
        title: "Ignore inactive project",
        user: { login: "issue-author" },
        labels: [{ name: "daoflow:run" }]
      },
      repository: { full_name: "example/dev-task-inactive" },
      installation: { id: Number(fixture.externalInstallationId) },
      sender: { login: "octocat" }
    });

    const response = await createApp().request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "issues",
        "X-GitHub-Delivery": "gh-dev-task-inactive",
        "X-Hub-Signature-256": signGitHubPayload("github-dev-task-inactive-secret", payload)
      },
      body: payload
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      skipped: true,
      reason: "no matching projects"
    });

    const rows = await db
      .select()
      .from(developmentTasks)
      .where(eq(developmentTasks.repoFullName, "example/dev-task-inactive"));
    expect(rows).toHaveLength(0);
  });

  it("queues a development task from a /daoflow run issue comment and records the trigger comment", async () => {
    await resetTestDatabaseWithControlPlane();
    const fixture = await createDevelopmentTaskWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/dev-task-comment",
      webhookSecret: "github-dev-task-comment-secret",
      externalInstallationId: "9103",
      githubAppCredentials: true
    });
    mockGitHubActorAuthorization("reviewer");

    const payload = JSON.stringify({
      action: "created",
      issue: {
        id: 185003,
        number: 187,
        html_url: "https://github.com/example/dev-task-comment/issues/187",
        title: "Comment-triggered task",
        user: { login: "issue-author" },
        labels: []
      },
      comment: {
        id: 440001,
        html_url: "https://github.com/example/dev-task-comment/issues/187#issuecomment-440001",
        body: "/daoflow run",
        user: { login: "reviewer" }
      },
      repository: { full_name: "example/dev-task-comment" },
      installation: { id: Number(fixture.externalInstallationId) },
      sender: { login: "reviewer" }
    });

    const response = await createApp().request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "issue_comment",
        "X-GitHub-Delivery": "gh-dev-task-comment",
        "X-Hub-Signature-256": signGitHubPayload("github-dev-task-comment-secret", payload)
      },
      body: payload
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      tasksQueued: 1,
      trigger: "comment"
    });

    const [task] = await db
      .select()
      .from(developmentTasks)
      .where(eq(developmentTasks.repoFullName, "example/dev-task-comment"));
    expect(task).toMatchObject({
      projectId: fixture.projectId,
      issueNumber: 187,
      requestedByExternalUser: "reviewer"
    });

    const comments = await db
      .select()
      .from(developmentTaskComments)
      .where(eq(developmentTaskComments.externalCommentId, "440001"));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      taskId: task.id,
      providerType: "github",
      commentKind: "trigger"
    });
  });

  it("rejects a /daoflow run issue comment from an actor without write permission", async () => {
    await resetTestDatabaseWithControlPlane();
    const fixture = await createDevelopmentTaskWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/dev-task-unauthorized",
      webhookSecret: "github-dev-task-unauthorized-secret",
      externalInstallationId: "9106",
      githubAppCredentials: true
    });
    expect(fixture.projectId).toBeTruthy();
    mockGitHubActorAuthorization("drive-by", "read");

    const payload = JSON.stringify({
      action: "created",
      issue: {
        id: 185006,
        number: 190,
        html_url: "https://github.com/example/dev-task-unauthorized/issues/190",
        title: "Unauthorized task",
        user: { login: "issue-author" },
        labels: []
      },
      comment: {
        id: 440006,
        html_url: "https://github.com/example/dev-task-unauthorized/issues/190#issuecomment-440006",
        body: "/daoflow run",
        user: { login: "drive-by" }
      },
      repository: { full_name: "example/dev-task-unauthorized" },
      installation: { id: Number(fixture.externalInstallationId) },
      sender: { login: "drive-by" }
    });

    const response = await createApp().request("/api/webhooks/github", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitHub-Event": "issue_comment",
        "X-GitHub-Delivery": "gh-dev-task-unauthorized",
        "X-Hub-Signature-256": signGitHubPayload("github-dev-task-unauthorized-secret", payload)
      },
      body: payload
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      tasksQueued: 0,
      trigger: "comment"
    });

    const rows = await db
      .select()
      .from(developmentTasks)
      .where(eq(developmentTasks.repoFullName, "example/dev-task-unauthorized"));
    expect(rows).toHaveLength(0);
  });
});
