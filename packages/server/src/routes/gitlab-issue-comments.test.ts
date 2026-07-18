import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/connection";
import { developmentTaskComments } from "../db/schema/development-tasks";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import {
  queueDevelopmentTask,
  recordDevelopmentTaskComment
} from "../db/services/development-tasks";
import { encodeGitInstallationPermissions } from "../db/services/git-providers";
import { createProject } from "../db/services/projects";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import { upsertQueuedGitLabDevelopmentTaskComment } from "./gitlab-issue-comments";

async function createGitLabTargetFixture() {
  const suffix = `${Date.now()}`;
  const providerId = `gitprov_glnote_${suffix}`.slice(0, 32);
  const installationId = `gitinst_glnote_${suffix}`.slice(0, 32);
  const repoFullName = "example/gitlab-status-note";
  const projectResult = await createProject({
    name: `GitLab Note ${suffix}`,
    repoUrl: `https://gitlab.example.com/${repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });

  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create GitLab note test project.");
  }

  await db.insert(gitProviders).values({
    id: providerId,
    teamId: "team_foundation",
    type: "gitlab",
    name: `GitLab Note ${suffix}`,
    baseUrl: "https://gitlab.example.com",
    webhookSecret: "gitlab-note-secret",
    status: "active",
    updatedAt: new Date()
  });

  await db.insert(gitInstallations).values({
    id: installationId,
    teamId: "team_foundation",
    providerId,
    installationId: "example",
    accountName: "example",
    accountType: "organization",
    repositorySelection: "selected",
    permissions: encodeGitInstallationPermissions({ accessToken: "glpat-status-note" }),
    status: "active",
    installedByUserId: "user_foundation_owner",
    updatedAt: new Date()
  });

  await db
    .update(projects)
    .set({
      repoFullName,
      sourceType: "compose",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      autoDeploy: false,
      defaultBranch: "main",
      updatedAt: new Date()
    })
    .where(eq(projects.id, projectResult.project.id));

  const [provider] = await db.select().from(gitProviders).where(eq(gitProviders.id, providerId));
  const [installation] = await db
    .select()
    .from(gitInstallations)
    .where(eq(gitInstallations.id, installationId));
  const [project] = await db
    .select()
    .from(projects)
    .where(eq(projects.id, projectResult.project.id));

  if (!provider || !installation || !project) {
    throw new Error("Failed to load GitLab note target fixture.");
  }

  return {
    repoFullName,
    target: {
      project,
      provider,
      installation
    }
  };
}

describe("GitLab issue notes", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("updates an existing queued status note", async () => {
    await resetTestDatabaseWithControlPlane();
    const fixture = await createGitLabTargetFixture();
    const queued = await queueDevelopmentTask({
      providerType: "gitlab",
      providerInstallationId: fixture.target.installation.id,
      projectId: fixture.target.project.id,
      repoFullName: fixture.repoFullName,
      externalIssueId: "gitlab-status-note-issue",
      issueNumber: 190,
      issueUrl: `https://gitlab.example.com/${fixture.repoFullName}/-/issues/190`,
      issueTitle: "Update status note",
      requestedByExternalUser: "octocat"
    });

    expect(queued.status).toBe("created");
    if (queued.status !== "created") {
      throw new Error("Expected development task to be created.");
    }

    await recordDevelopmentTaskComment({
      taskId: queued.task.id,
      providerType: "gitlab",
      externalCommentId: "990301",
      commentKind: "status",
      lastBodyHash: "old-body-hash",
      metadata: {
        status: "queued",
        commentUrl: `https://gitlab.example.com/${fixture.repoFullName}/-/issues/190#note_990301`
      }
    });

    const fetchMock = vi.spyOn(globalThis, "fetch").mockResolvedValueOnce(
      new Response(
        JSON.stringify({
          id: 990301,
          web_url: `https://gitlab.example.com/${fixture.repoFullName}/-/issues/190#note_990301`
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )
    );

    await upsertQueuedGitLabDevelopmentTaskComment({
      taskId: queued.task.id,
      repoFullName: fixture.repoFullName,
      issueNumber: 190,
      target: fixture.target
    });

    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://gitlab.example.com/api/v4/projects/example%2Fgitlab-status-note/issues/190/notes/990301"
    );
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");

    const comments = await db
      .select()
      .from(developmentTaskComments)
      .where(eq(developmentTaskComments.taskId, queued.task.id));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      externalCommentId: "990301",
      commentKind: "status",
      providerType: "gitlab"
    });
  });

  it("recreates a queued status note when the recorded GitLab note was deleted", async () => {
    await resetTestDatabaseWithControlPlane();
    const fixture = await createGitLabTargetFixture();
    const queued = await queueDevelopmentTask({
      providerType: "gitlab",
      providerInstallationId: fixture.target.installation.id,
      projectId: fixture.target.project.id,
      repoFullName: fixture.repoFullName,
      externalIssueId: "deleted-gitlab-note-issue",
      issueNumber: 191,
      issueUrl: `https://gitlab.example.com/${fixture.repoFullName}/-/issues/191`,
      issueTitle: "Recover deleted status note",
      requestedByExternalUser: "octocat"
    });

    expect(queued.status).toBe("created");
    if (queued.status !== "created") {
      throw new Error("Expected development task to be created.");
    }

    await recordDevelopmentTaskComment({
      taskId: queued.task.id,
      providerType: "gitlab",
      externalCommentId: "990401",
      commentKind: "status",
      lastBodyHash: "old-body-hash",
      metadata: {
        status: "queued",
        commentUrl: `https://gitlab.example.com/${fixture.repoFullName}/-/issues/191#note_990401`
      }
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "404 Not found" }), { status: 404 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 990402,
            web_url: `https://gitlab.example.com/${fixture.repoFullName}/-/issues/191#note_990402`
          }),
          { status: 201, headers: { "Content-Type": "application/json" } }
        )
      );

    await upsertQueuedGitLabDevelopmentTaskComment({
      taskId: queued.task.id,
      repoFullName: fixture.repoFullName,
      issueNumber: 191,
      target: fixture.target
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[0]?.[1]?.method).toBe("PUT");
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://gitlab.example.com/api/v4/projects/example%2Fgitlab-status-note/issues/191/notes"
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("POST");

    const comments = await db
      .select()
      .from(developmentTaskComments)
      .where(eq(developmentTaskComments.taskId, queued.task.id));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      externalCommentId: "990402",
      commentKind: "status",
      providerType: "gitlab"
    });
  });
});
