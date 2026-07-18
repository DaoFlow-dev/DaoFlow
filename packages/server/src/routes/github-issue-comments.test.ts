import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/connection";
import { encrypt } from "../db/crypto";
import { developmentTaskComments } from "../db/schema/development-tasks";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import {
  queueDevelopmentTask,
  recordDevelopmentTaskComment
} from "../db/services/development-tasks";
import { createProject } from "../db/services/projects";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import { upsertQueuedGitHubDevelopmentTaskComment } from "./github-issue-comments";

async function createGitHubTargetFixture() {
  const suffix = `${Date.now()}`;
  const providerId = `gitprov_comment_${suffix}`.slice(0, 32);
  const installationId = `gitinst_comment_${suffix}`.slice(0, 32);
  const repoFullName = "example/deleted-status-comment";
  const projectResult = await createProject({
    name: `GitHub Comment Recovery ${suffix}`,
    repoUrl: `https://github.com/${repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });

  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create GitHub comment test project.");
  }

  const privateKeyPem = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ format: "pem", type: "pkcs1" })
    .toString();

  await db.insert(gitProviders).values({
    id: providerId,
    teamId: "team_foundation",
    type: "github",
    name: `GitHub Comment Recovery ${suffix}`,
    appId: "123456",
    privateKeyEncrypted: encrypt(privateKeyPem),
    webhookSecret: "github-comment-recovery-secret",
    status: "active",
    updatedAt: new Date()
  });

  await db.insert(gitInstallations).values({
    id: installationId,
    teamId: "team_foundation",
    providerId,
    installationId: "9106",
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
    throw new Error("Failed to load GitHub comment target fixture.");
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

describe("GitHub issue comments", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.APP_BASE_URL;
  });

  it("recreates a queued status comment when the recorded GitHub comment was deleted", async () => {
    await resetTestDatabaseWithControlPlane();
    process.env.APP_BASE_URL = "https://daoflow.example.test";
    const fixture = await createGitHubTargetFixture();
    const queued = await queueDevelopmentTask({
      providerType: "github",
      providerInstallationId: fixture.target.installation.id,
      projectId: fixture.target.project.id,
      repoFullName: fixture.repoFullName,
      externalIssueId: "deleted-comment-issue",
      issueNumber: 190,
      issueUrl: `https://github.com/${fixture.repoFullName}/issues/190`,
      issueTitle: "Recover deleted status comment",
      requestedByExternalUser: "octocat"
    });

    expect(queued.status).toBe("created");
    if (queued.status !== "created") {
      throw new Error("Expected development task to be created.");
    }

    await recordDevelopmentTaskComment({
      taskId: queued.task.id,
      providerType: "github",
      externalCommentId: "990001",
      commentKind: "status",
      lastBodyHash: "old-body-hash",
      metadata: {
        status: "queued",
        commentUrl: `https://github.com/${fixture.repoFullName}/issues/190#issuecomment-990001`
      }
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "ghs_installation_token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ message: "Not Found" }), { status: 404 })
      )
      .mockResolvedValueOnce(
        new Response(
          JSON.stringify({
            id: 990002,
            html_url: `https://github.com/${fixture.repoFullName}/issues/190#issuecomment-990002`
          }),
          {
            status: 201,
            headers: { "Content-Type": "application/json" }
          }
        )
      );

    await upsertQueuedGitHubDevelopmentTaskComment({
      taskId: queued.task.id,
      repoFullName: fixture.repoFullName,
      issueNumber: 190,
      target: fixture.target
    });

    expect(fetchMock).toHaveBeenCalledTimes(3);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.github.com/repos/example/deleted-status-comment/issues/comments/990001"
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PATCH");
    expect(fetchMock.mock.calls[2]?.[0]).toBe(
      "https://api.github.com/repos/example/deleted-status-comment/issues/190/comments"
    );
    expect(fetchMock.mock.calls[2]?.[1]?.method).toBe("POST");

    const comments = await db
      .select()
      .from(developmentTaskComments)
      .where(eq(developmentTaskComments.taskId, queued.task.id));
    expect(comments).toHaveLength(1);
    expect(comments[0]).toMatchObject({
      externalCommentId: "990002",
      commentKind: "status",
      providerType: "github"
    });
    expect(comments[0].metadata).toMatchObject({
      status: "queued",
      commentUrl: `https://github.com/${fixture.repoFullName}/issues/190#issuecomment-990002`
    });
  });
});
