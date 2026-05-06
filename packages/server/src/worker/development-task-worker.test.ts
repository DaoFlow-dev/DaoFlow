import { generateKeyPairSync } from "node:crypto";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/connection";
import { encrypt } from "../db/crypto";
import { developmentTaskComments } from "../db/schema/development-tasks";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import {
  getDevelopmentTaskDetails,
  queueDevelopmentTask,
  recordDevelopmentTaskComment
} from "../db/services/development-tasks";
import { createProject } from "../db/services/projects";
import { resetSeededTestDatabase } from "../test-db";
import { pollDevelopmentTaskQueue } from "./development-task-worker";

async function createClaimedCommentFixture() {
  const suffix = `${Date.now()}`;
  const providerId = `gitprov_worker_${suffix}`.slice(0, 32);
  const installationId = `gitinst_worker_${suffix}`.slice(0, 32);
  const repoFullName = "example/worker-status-comment";
  const projectResult = await createProject({
    name: `Worker Status Comment ${suffix}`,
    repoUrl: `https://github.com/${repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });

  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create worker status comment project.");
  }

  const privateKeyPem = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ format: "pem", type: "pkcs1" })
    .toString();

  await db.insert(gitProviders).values({
    id: providerId,
    type: "github",
    name: `GitHub Worker Status ${suffix}`,
    appId: "123456",
    privateKeyEncrypted: encrypt(privateKeyPem),
    webhookSecret: "github-worker-status-secret",
    status: "active",
    updatedAt: new Date()
  });

  await db.insert(gitInstallations).values({
    id: installationId,
    providerId,
    installationId: "9107",
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

  return {
    projectId: projectResult.project.id,
    repoFullName,
    installationId
  };
}

describe("development task worker", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    delete process.env.APP_BASE_URL;
  });

  it("updates the durable GitHub status comment when claiming a task", async () => {
    await resetSeededTestDatabase();
    process.env.APP_BASE_URL = "https://daoflow.example.test";
    const fixture = await createClaimedCommentFixture();
    const queued = await queueDevelopmentTask({
      providerType: "github",
      providerInstallationId: fixture.installationId,
      projectId: fixture.projectId,
      repoFullName: fixture.repoFullName,
      externalIssueId: "worker-status-issue",
      issueNumber: 191,
      issueUrl: `https://github.com/${fixture.repoFullName}/issues/191`,
      issueTitle: "Update issue when worker starts",
      requestedByExternalUser: "octocat"
    });

    expect(queued.status).toBe("created");
    if (queued.status !== "created") {
      throw new Error("Expected development task to be created.");
    }

    await recordDevelopmentTaskComment({
      taskId: queued.task.id,
      providerType: "github",
      externalCommentId: "990010",
      commentKind: "status",
      lastBodyHash: "queued-hash",
      metadata: {
        status: "queued",
        commentUrl: `https://github.com/${fixture.repoFullName}/issues/191#issuecomment-990010`
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
      .mockImplementationOnce((_url, init) => {
        const rawBody = init?.body;
        if (typeof rawBody !== "string") {
          throw new Error("Expected GitHub issue comment request body to be a string.");
        }
        const body = JSON.parse(rawBody) as { body?: string };
        expect(body.body).toContain("DaoFlow started work.");
        expect(body.body).toContain("Status: running");
        expect(body.body).toContain("Runner: development-task-worker");
        expect(body.body).toContain("Run: https://daoflow.example.test/development-tasks/");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              id: 990010,
              html_url: `https://github.com/${fixture.repoFullName}/issues/191#issuecomment-990010`
            }),
            {
              status: 200,
              headers: { "Content-Type": "application/json" }
            }
          )
        );
      });

    const claimed = await pollDevelopmentTaskQueue();

    expect(claimed?.task.id).toBe(queued.task.id);
    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.github.com/repos/example/worker-status-comment/issues/comments/990010"
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PATCH");

    const [comment] = await db
      .select()
      .from(developmentTaskComments)
      .where(eq(developmentTaskComments.externalCommentId, "990010"));
    expect(comment).toMatchObject({
      taskId: queued.task.id,
      runId: claimed?.run.id,
      providerType: "github",
      commentKind: "status"
    });
    expect(comment.metadata).toMatchObject({
      status: "running",
      commentUrl: `https://github.com/${fixture.repoFullName}/issues/191#issuecomment-990010`
    });

    const details = await getDevelopmentTaskDetails(queued.task.id);
    expect(details?.events.some((event) => event.kind === "comment.updated")).toBe(true);
  });
});
