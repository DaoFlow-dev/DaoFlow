import { createHmac } from "node:crypto";
import { eq } from "drizzle-orm";
import { describe, expect, it } from "vitest";
import { createApp } from "./app";
import { db } from "./db/connection";
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

  await db.insert(gitProviders).values({
    id: providerId,
    type: "github",
    name: `GitHub Development Task ${input.suffix}`,
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

describe("GitHub development task webhooks", () => {
  it("queues a development task from a daoflow:run issue label without requiring auto-deploy", async () => {
    await resetTestDatabaseWithControlPlane();
    const fixture = await createDevelopmentTaskWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/dev-task-label",
      webhookSecret: "github-dev-task-label-secret",
      externalInstallationId: "9101"
    });

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

  it("deduplicates repeated issue label deliveries", async () => {
    await resetTestDatabaseWithControlPlane();
    const fixture = await createDevelopmentTaskWebhookFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/dev-task-dedupe",
      webhookSecret: "github-dev-task-dedupe-secret",
      externalInstallationId: "9102"
    });

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
      externalInstallationId: "9103"
    });

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
});
