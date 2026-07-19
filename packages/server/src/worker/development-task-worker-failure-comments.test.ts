import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/connection";
import { sandboxRunnerProfiles } from "../db/schema/development-tasks";
import { DEFAULT_HOST_RUNNER_PROFILE_ID } from "../db/services/default-development-runner";
import {
  queueDevelopmentTask,
  recordDevelopmentTaskComment
} from "../db/services/development-tasks";
import { resetSeededTestDatabase } from "../test-db";
import {
  pollDevelopmentTaskQueue,
  resetDevelopmentTaskCodexExecutionForTests,
  resetDevelopmentTaskPreviewQueuingForTests,
  resetDevelopmentTaskPullRequestOpeningForTests,
  resetDevelopmentTaskRepositoryCheckoutForTests,
  resetDevelopmentTaskValidationExecutionForTests,
  setDevelopmentTaskCodexExecutionForTests,
  setDevelopmentTaskRepositoryCheckoutForTests,
  setDevelopmentTaskValidationExecutionForTests
} from "./development-task-worker";
import { createClaimedCommentFixture } from "./development-task-worker.test-support";

function readCommentBody(init: RequestInit | undefined) {
  if (typeof init?.body !== "string") {
    throw new Error("Expected issue comment request body.");
  }
  return JSON.parse(init.body) as { body?: string };
}

describe("development task worker failure comments", () => {
  afterEach(() => {
    resetDevelopmentTaskCodexExecutionForTests();
    resetDevelopmentTaskPreviewQueuingForTests();
    resetDevelopmentTaskPullRequestOpeningForTests();
    resetDevelopmentTaskRepositoryCheckoutForTests();
    resetDevelopmentTaskValidationExecutionForTests();
    vi.restoreAllMocks();
    delete process.env.APP_BASE_URL;
    delete process.env.DAOFLOW_DEVELOPMENT_TASK_WORKSPACE_ROOT;
  });

  it("updates the source issue status comment when Codex execution fails", async () => {
    await resetSeededTestDatabase();
    process.env.APP_BASE_URL = "https://daoflow.example.test";
    process.env.DAOFLOW_DEVELOPMENT_TASK_WORKSPACE_ROOT = await mkdtemp(
      `${tmpdir()}/daoflow-worker-failure-`
    );
    const fixture = await createClaimedCommentFixture();
    const queued = await queueDevelopmentTask({
      providerType: "github",
      providerInstallationId: fixture.installationId,
      projectId: fixture.projectId,
      repoFullName: fixture.repoFullName,
      externalIssueId: "worker-failure-issue",
      issueNumber: 192,
      issueUrl: `https://github.com/${fixture.repoFullName}/issues/192`,
      issueTitle: "Report Codex failure",
      requestedByExternalUser: "octocat"
    });

    expect(queued.status).toBe("created");
    if (queued.status !== "created") {
      throw new Error("Expected development task to be created.");
    }

    await recordDevelopmentTaskComment({
      taskId: queued.task.id,
      providerType: "github",
      externalCommentId: "990011",
      commentKind: "status",
      lastBodyHash: "queued-hash",
      metadata: { status: "queued" }
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "ghs_token" }), { status: 200 }))
      .mockImplementationOnce((_url, init) => {
        const body = readCommentBody(init);
        expect(body.body).toContain("Status: running");
        return Promise.resolve(new Response(JSON.stringify({ id: 990011 }), { status: 200 }));
      })
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "ghs_token" }), { status: 200 }))
      .mockImplementationOnce((_url, init) => {
        const body = readCommentBody(init);
        expect(body.body).toContain("Status: failed");
        expect(body.body).toContain("Failure: codex_execution_failed");
        expect(body.body).toContain("Message: Codex exited 1.");
        return Promise.resolve(new Response(JSON.stringify({ id: 990011 }), { status: 200 }));
      });

    setDevelopmentTaskRepositoryCheckoutForTests((input) =>
      Promise.resolve({
        status: "ok" as const,
        repoPath: input.repoPath,
        branch: "main",
        displayLabel: fixture.repoFullName
      })
    );
    setDevelopmentTaskCodexExecutionForTests(() =>
      Promise.resolve({
        status: "failed" as const,
        exitCode: 1,
        logPath: "/tmp/codex.jsonl",
        errorMessage: "Codex exited 1."
      })
    );
    const validationExecution = vi.fn();
    setDevelopmentTaskValidationExecutionForTests(validationExecution);

    await pollDevelopmentTaskQueue();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://api.github.com/repos/example/worker-status-comment/issues/comments/990011"
    );
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("PATCH");
    expect(validationExecution).not.toHaveBeenCalled();
  });

  it("updates the source issue status comment when sandbox capabilities block execution", async () => {
    await resetSeededTestDatabase();
    process.env.APP_BASE_URL = "https://daoflow.example.test";
    process.env.DAOFLOW_DEVELOPMENT_TASK_WORKSPACE_ROOT = await mkdtemp(
      `${tmpdir()}/daoflow-worker-capability-`
    );
    await db
      .update(sandboxRunnerProfiles)
      .set({ metadata: { capabilities: ["files.read"] }, updatedAt: new Date() })
      .where(eq(sandboxRunnerProfiles.id, DEFAULT_HOST_RUNNER_PROFILE_ID));
    const fixture = await createClaimedCommentFixture();
    const queued = await queueDevelopmentTask({
      providerType: "github",
      providerInstallationId: fixture.installationId,
      projectId: fixture.projectId,
      repoFullName: fixture.repoFullName,
      externalIssueId: "worker-capability-issue",
      issueNumber: 193,
      issueUrl: `https://github.com/${fixture.repoFullName}/issues/193`,
      issueTitle: "Report sandbox capability failure",
      requestedByExternalUser: "octocat"
    });

    if (queued.status !== "created") {
      throw new Error("Expected development task to be created.");
    }

    await recordDevelopmentTaskComment({
      taskId: queued.task.id,
      providerType: "github",
      externalCommentId: "990012",
      commentKind: "status",
      lastBodyHash: "queued-hash",
      metadata: { status: "queued" }
    });

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "ghs_token" }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 990012 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ token: "ghs_token" }), { status: 200 }))
      .mockImplementationOnce((_url, init) => {
        const body = readCommentBody(init);
        expect(body.body).toContain("Failure: sandbox_capability_missing");
        expect(body.body).toContain(
          "Message: The selected sandbox runner does not support command execution."
        );
        return Promise.resolve(new Response(JSON.stringify({ id: 990012 }), { status: 200 }));
      });
    const codexExecution = vi.fn();
    setDevelopmentTaskRepositoryCheckoutForTests((input) =>
      Promise.resolve({
        status: "ok" as const,
        repoPath: input.repoPath,
        branch: "main",
        displayLabel: fixture.repoFullName
      })
    );
    setDevelopmentTaskCodexExecutionForTests(codexExecution);

    await pollDevelopmentTaskQueue();

    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(codexExecution).not.toHaveBeenCalled();
  });
});
