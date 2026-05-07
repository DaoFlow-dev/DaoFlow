import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createApp } from "./app";
import { db } from "./db/connection";
import { developmentTaskComments, developmentTasks } from "./db/schema/development-tasks";
import { gitInstallations, gitProviders } from "./db/schema/git-providers";
import { projects } from "./db/schema/projects";
import { encodeGitInstallationPermissions } from "./db/services/git-providers";
import { createProject } from "./db/services/projects";
import { resetTestDatabaseWithControlPlane } from "./test-db";

async function createGitLabDevelopmentTaskFixture(input: {
  suffix: string;
  repoFullName: string;
  webhookSecret: string;
}) {
  const providerId = `gitprov_gldev_${input.suffix}`.slice(0, 32);
  const installationId = `gitinst_gldev_${input.suffix}`.slice(0, 32);
  const projectResult = await createProject({
    name: `GitLab Development Task ${input.suffix}`,
    repoUrl: `https://gitlab.example.com/${input.repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });

  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create GitLab development task fixture.");
  }

  await db.insert(gitProviders).values({
    id: providerId,
    type: "gitlab",
    name: `GitLab Development Task ${input.suffix}`,
    baseUrl: "https://gitlab.example.com",
    webhookSecret: input.webhookSecret,
    status: "active",
    updatedAt: new Date()
  });

  await db.insert(gitInstallations).values({
    id: installationId,
    providerId,
    installationId: "example",
    accountName: "example",
    accountType: "organization",
    repositorySelection: "selected",
    permissions: encodeGitInstallationPermissions({ accessToken: "glpat-development-task" }),
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

  return { projectId: projectResult.project.id };
}

function mockGitLabActorAuthorization(actor: string, accessLevel = 30) {
  return vi.spyOn(globalThis, "fetch").mockImplementationOnce((url) => {
    expect(requestUrl(url)).toContain(`/members/all?query=${encodeURIComponent(actor)}`);
    return Promise.resolve(
      new Response(JSON.stringify([{ username: actor, access_level: accessLevel }]), {
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

describe("GitLab development task webhooks", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.APP_BASE_URL;
  });

  it("queues a development task from a daoflow:run issue label and posts a status note", async () => {
    await resetTestDatabaseWithControlPlane();
    process.env.APP_BASE_URL = "https://daoflow.example.test";
    const fixture = await createGitLabDevelopmentTaskFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/gitlab-dev-task-label",
      webhookSecret: "gitlab-dev-task-label-secret"
    });
    const fetchMock = mockGitLabActorAuthorization("octocat").mockImplementationOnce(
      (_url, init) => {
        if (typeof init?.body !== "string") {
          throw new Error("Expected GitLab note body.");
        }
        const body = JSON.parse(init.body) as { body?: string };
        expect(body.body).toContain("DaoFlow accepted this task.");
        expect(body.body).toContain("Status: queued");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 990101,
              web_url:
                "https://gitlab.example.com/example/gitlab-dev-task-label/-/issues/185#note_990101"
            }),
            { status: 201, headers: { "Content-Type": "application/json" } }
          )
        );
      }
    );

    const payload = JSON.stringify({
      object_kind: "issue",
      event_type: "issue",
      user: { username: "octocat" },
      project: {
        path_with_namespace: "example/gitlab-dev-task-label",
        web_url: "https://gitlab.example.com/example/gitlab-dev-task-label"
      },
      object_attributes: {
        id: 185001,
        iid: 185,
        title: "Build the agent task runner",
        url: "https://gitlab.example.com/example/gitlab-dev-task-label/-/issues/185",
        action: "update",
        labels: [{ title: "daoflow:run" }]
      },
      changes: {
        labels: {
          previous: [],
          current: [{ title: "daoflow:run" }]
        }
      }
    });

    const response = await createApp().request("/api/webhooks/gitlab", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitLab-Event": "Issue Hook",
        "X-Gitlab-Event-UUID": "gl-dev-task-label",
        "X-Gitlab-Token": "gitlab-dev-task-label-secret"
      },
      body: payload
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({ ok: true, tasksQueued: 1 });
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://gitlab.example.com/api/v4/projects/example%2Fgitlab-dev-task-label/issues/185/notes"
    );

    const [task] = await db
      .select()
      .from(developmentTasks)
      .where(eq(developmentTasks.repoFullName, "example/gitlab-dev-task-label"));
    expect(task).toMatchObject({
      projectId: fixture.projectId,
      providerType: "gitlab",
      issueNumber: 185,
      issueTitle: "Build the agent task runner",
      requestedByExternalUser: "octocat",
      status: "queued"
    });

    const comments = await db
      .select()
      .from(developmentTaskComments)
      .where(eq(developmentTaskComments.externalCommentId, "990101"));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      taskId: task.id,
      providerType: "gitlab",
      commentKind: "status"
    });
  });

  it("ignores ordinary GitLab issue updates when labels did not change", async () => {
    await resetTestDatabaseWithControlPlane();
    await createGitLabDevelopmentTaskFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/gitlab-dev-task-edit",
      webhookSecret: "gitlab-dev-task-edit-secret"
    });

    const payload = JSON.stringify({
      object_kind: "issue",
      event_type: "issue",
      user: { username: "octocat" },
      project: {
        path_with_namespace: "example/gitlab-dev-task-edit",
        web_url: "https://gitlab.example.com/example/gitlab-dev-task-edit"
      },
      object_attributes: {
        id: 185003,
        iid: 187,
        title: "Edited GitLab task",
        url: "https://gitlab.example.com/example/gitlab-dev-task-edit/-/issues/187",
        action: "update",
        labels: [{ title: "daoflow:run" }]
      }
    });

    const response = await createApp().request("/api/webhooks/gitlab", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitLab-Event": "Issue Hook",
        "X-Gitlab-Event-UUID": "gl-dev-task-edit",
        "X-Gitlab-Token": "gitlab-dev-task-edit-secret"
      },
      body: payload
    });

    expect(response.status).toBe(200);
    expect(await response.json()).toMatchObject({
      ok: true,
      skipped: true,
      reason: "unsupported development task trigger"
    });

    const rows = await db
      .select()
      .from(developmentTasks)
      .where(eq(developmentTasks.repoFullName, "example/gitlab-dev-task-edit"));
    expect(rows).toHaveLength(0);
  });

  it("queues a development task from a /daoflow run issue note and records the trigger note", async () => {
    await resetTestDatabaseWithControlPlane();
    const fixture = await createGitLabDevelopmentTaskFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/gitlab-dev-task-note",
      webhookSecret: "gitlab-dev-task-note-secret"
    });
    mockGitLabActorAuthorization("reviewer").mockResolvedValueOnce(
      new Response(JSON.stringify({ id: 990102 }), {
        status: 201,
        headers: { "Content-Type": "application/json" }
      })
    );

    const payload = JSON.stringify({
      object_kind: "note",
      event_type: "note",
      user: { username: "reviewer" },
      project: {
        path_with_namespace: "example/gitlab-dev-task-note",
        web_url: "https://gitlab.example.com/example/gitlab-dev-task-note"
      },
      issue: {
        id: 185002,
        iid: 186,
        title: "Comment-triggered GitLab task",
        web_url: "https://gitlab.example.com/example/gitlab-dev-task-note/-/issues/186",
        author: { username: "issue-author" }
      },
      object_attributes: {
        id: 440101,
        action: "create",
        noteable_type: "Issue",
        note: "/daoflow run",
        url: "https://gitlab.example.com/example/gitlab-dev-task-note/-/issues/186#note_440101"
      }
    });

    const response = await createApp().request("/api/webhooks/gitlab", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitLab-Event": "Note Hook",
        "X-Gitlab-Event-UUID": "gl-dev-task-note",
        "X-Gitlab-Token": "gitlab-dev-task-note-secret"
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
      .where(eq(developmentTasks.repoFullName, "example/gitlab-dev-task-note"));
    expect(task).toMatchObject({
      projectId: fixture.projectId,
      issueNumber: 186,
      requestedByExternalUser: "reviewer"
    });

    const comments = await db
      .select()
      .from(developmentTaskComments)
      .where(eq(developmentTaskComments.externalCommentId, "440101"));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      taskId: task.id,
      providerType: "gitlab",
      commentKind: "trigger"
    });
  });

  it("rejects a /daoflow run issue note from an actor below Developer access", async () => {
    await resetTestDatabaseWithControlPlane();
    await createGitLabDevelopmentTaskFixture({
      suffix: `${Date.now()}`,
      repoFullName: "example/gitlab-dev-task-unauthorized",
      webhookSecret: "gitlab-dev-task-unauthorized-secret"
    });
    mockGitLabActorAuthorization("guest", 20);

    const payload = JSON.stringify({
      object_kind: "note",
      event_type: "note",
      user: { username: "guest" },
      project: {
        path_with_namespace: "example/gitlab-dev-task-unauthorized",
        web_url: "https://gitlab.example.com/example/gitlab-dev-task-unauthorized"
      },
      issue: {
        id: 185004,
        iid: 188,
        title: "Unauthorized GitLab task",
        web_url: "https://gitlab.example.com/example/gitlab-dev-task-unauthorized/-/issues/188",
        author: { username: "issue-author" }
      },
      object_attributes: {
        id: 440104,
        action: "create",
        noteable_type: "Issue",
        note: "/daoflow run",
        url: "https://gitlab.example.com/example/gitlab-dev-task-unauthorized/-/issues/188#note_440104"
      }
    });

    const response = await createApp().request("/api/webhooks/gitlab", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-GitLab-Event": "Note Hook",
        "X-Gitlab-Event-UUID": "gl-dev-task-unauthorized",
        "X-Gitlab-Token": "gitlab-dev-task-unauthorized-secret"
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
      .where(eq(developmentTasks.repoFullName, "example/gitlab-dev-task-unauthorized"));
    expect(rows).toHaveLength(0);
  });
});
