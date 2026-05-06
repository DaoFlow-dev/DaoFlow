import { mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { afterEach, describe, expect, it, vi } from "vitest";
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
});
