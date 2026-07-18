import { mkdtemp, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/connection";
import { auditEntries } from "../db/schema/audit";
import { developmentTaskRuns } from "../db/schema/development-tasks";
import {
  getDevelopmentTaskDetails,
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
  setDevelopmentTaskPreviewQueuingForTests,
  setDevelopmentTaskPullRequestOpeningForTests,
  setDevelopmentTaskRepositoryCheckoutForTests,
  setDevelopmentTaskValidationExecutionForTests
} from "./development-task-worker";
import { createClaimedCommentFixture } from "./development-task-worker.test-support";

describe("development task worker", () => {
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

  it("updates the durable GitHub status comment and prepares the Codex workspace", async () => {
    await resetSeededTestDatabase();
    process.env.APP_BASE_URL = "https://daoflow.example.test";
    process.env.DAOFLOW_DEVELOPMENT_TASK_WORKSPACE_ROOT = await mkdtemp(
      `${tmpdir()}/daoflow-worker-workspace-`
    );
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
        expect(body.body).toContain("DaoFlow opened a pull request.");
        expect(body.body).toContain("Status: waiting_review");
        expect(body.body).toContain("Pull request: https://github.com/example/repo/pull/42");
        expect(body.body).toContain("Preview: https://pr-42.preview.example.test");
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

    const checkoutMock = vi.fn().mockImplementation((input: { repoPath: string }) =>
      Promise.resolve({
        status: "ok" as const,
        repoPath: input.repoPath,
        branch: "main",
        displayLabel: fixture.repoFullName
      })
    );
    setDevelopmentTaskRepositoryCheckoutForTests(checkoutMock);
    const codexExecutionMock = vi
      .fn()
      .mockImplementation((input: { workspace: { logsPath: string } }) =>
        Promise.resolve({
          status: "ok" as const,
          exitCode: 0,
          logPath: `${input.workspace.logsPath}/codex-exec.jsonl`
        })
      );
    setDevelopmentTaskCodexExecutionForTests(codexExecutionMock);
    const validationExecutionMock = vi
      .fn()
      .mockImplementation((input: { workspace: { logsPath: string }; commands: string[] }) =>
        Promise.resolve({
          status: "ok" as const,
          commands: input.commands,
          logPath: `${input.workspace.logsPath}/validation.jsonl`
        })
      );
    setDevelopmentTaskValidationExecutionForTests(validationExecutionMock);
    const pullRequestOpeningMock = vi
      .fn()
      .mockImplementation((input: { workspace: { logsPath: string } }) =>
        Promise.resolve({
          status: "ok" as const,
          branchName: "daoflow/issue-191-worker",
          commitSha: "abc123",
          pullRequestNumber: 42,
          pullRequestUrl: "https://github.com/example/repo/pull/42",
          logPath: `${input.workspace.logsPath}/pull-request.jsonl`
        })
      );
    setDevelopmentTaskPullRequestOpeningForTests(pullRequestOpeningMock);
    const previewQueuingMock = vi.fn().mockResolvedValue({
      status: "queued" as const,
      previewDeploymentId: "dep_preview_42",
      previewUrl: "https://pr-42.preview.example.test",
      deployments: [
        {
          serviceId: "svc_preview_42",
          serviceName: "web",
          deploymentId: "dep_preview_42",
          previewUrl: "https://pr-42.preview.example.test",
          status: "queued" as const
        }
      ]
    });
    setDevelopmentTaskPreviewQueuingForTests(previewQueuingMock);

    const claimed = await pollDevelopmentTaskQueue();
    const checkoutCall = checkoutMock.mock.calls[0]?.[0] as
      { repoPath: string; artifactsPath: string } | undefined;
    const validationCall = validationExecutionMock.mock.calls[0]?.[0] as
      { allowedCommands?: string[] } | undefined;

    expect(claimed?.task.id).toBe(queued.task.id);
    expect(checkoutMock).toHaveBeenCalledOnce();
    expect(codexExecutionMock).toHaveBeenCalledOnce();
    expect(validationExecutionMock).toHaveBeenCalledOnce();
    expect(pullRequestOpeningMock).toHaveBeenCalledOnce();
    expect(previewQueuingMock).toHaveBeenCalledOnce();
    expect(validationCall?.allowedCommands).toEqual([
      "bun run format",
      "bun run test:unit",
      "bun run lint",
      "bun run typecheck",
      "bun run contracts:check"
    ]);
    expect(checkoutCall?.repoPath).toContain(claimed?.run.id ?? "");
    expect(checkoutCall?.artifactsPath).toContain(claimed?.run.id ?? "");
    expect(fetchMock).toHaveBeenCalledTimes(4);
    expect(fetchMock.mock.calls[1]?.[0]).toBe(
      "https://api.github.com/repos/example/worker-status-comment/issues/comments/990010"
    );
    expect(fetchMock.mock.calls[1]?.[1]?.method).toBe("PATCH");
    expect(fetchMock.mock.calls[3]?.[0]).toBe(
      "https://api.github.com/repos/example/worker-status-comment/issues/comments/990010"
    );
    expect(fetchMock.mock.calls[3]?.[1]?.method).toBe("PATCH");

    const [run] = await db
      .select()
      .from(developmentTaskRuns)
      .where(eq(developmentTaskRuns.id, claimed?.run.id ?? ""));
    expect(run).toMatchObject({
      status: "waiting_review",
      branchName: "daoflow/issue-191-worker",
      commitSha: "abc123",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/example/repo/pull/42",
      previewDeploymentId: "dep_preview_42",
      previewUrl: "https://pr-42.preview.example.test"
    });
    const metadata = run?.metadata as {
      codexWorkspace?: {
        configPath: string;
        logsPath: string;
        promptPath: string;
        repoPath: string;
      };
      codexCommand?: { args: string[] };
      codexExecution?: { status: string; exitCode: number; logPath: string };
      pullRequest?: { status: string; pullRequestUrl: string; logPath: string };
      preview?: { status: string; previewUrl: string; previewDeploymentId: string };
      repositoryCheckout?: { status: string; displayLabel: string };
      validation?: { status: string; commands: string[]; logPath: string };
    };
    expect(metadata.codexWorkspace?.repoPath).toContain(claimed?.run.id);
    expect(metadata.repositoryCheckout).toMatchObject({
      status: "ok",
      displayLabel: fixture.repoFullName
    });
    expect(metadata.codexCommand?.args).toContain(`@${metadata.codexWorkspace?.promptPath}`);
    expect(metadata.codexExecution).toMatchObject({
      status: "ok",
      exitCode: 0,
      logPath: `${metadata.codexWorkspace?.logsPath}/codex-exec.jsonl`
    });
    expect(metadata.validation).toMatchObject({
      status: "ok",
      logPath: `${metadata.codexWorkspace?.logsPath}/validation.jsonl`
    });
    expect(metadata.pullRequest).toMatchObject({
      status: "ok",
      pullRequestUrl: "https://github.com/example/repo/pull/42",
      logPath: `${metadata.codexWorkspace?.logsPath}/pull-request.jsonl`
    });
    expect(metadata.preview).toMatchObject({
      status: "queued",
      previewDeploymentId: "dep_preview_42",
      previewUrl: "https://pr-42.preview.example.test"
    });
    expect(metadata.codexCommand?.args.join("\n")).not.toContain("Update issue when worker starts");
    expect((await stat(metadata.codexWorkspace?.repoPath ?? "")).isDirectory()).toBe(true);
    await expect(readFile(metadata.codexWorkspace?.configPath ?? "", "utf8")).resolves.toContain(
      "[profiles.daoflow]"
    );
    await expect(readFile(metadata.codexWorkspace?.promptPath ?? "", "utf8")).resolves.toContain(
      "Update issue when worker starts"
    );

    const details = await getDevelopmentTaskDetails(queued.task.id);
    const eventKinds = details?.events.map((event) => event.kind) ?? [];
    expect(eventKinds).toEqual(
      expect.arrayContaining(["run.preparing", "run.coding", "run.validating", "run.opening_pr"])
    );
    const auditRows = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `development_task/${queued.task.id}`));
    expect(auditRows.map((entry) => entry.action)).toEqual(
      expect.arrayContaining([
        "development_task.pull_request.open",
        "development_task.preview.queue"
      ])
    );
  });
});
