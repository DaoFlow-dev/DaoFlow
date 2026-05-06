import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "../db/connection";
import { auditEntries } from "../db/schema/audit";
import { developmentTaskRuns } from "../db/schema/development-tasks";
import { createDevelopmentTaskRun, queueDevelopmentTask } from "../db/services/development-tasks";
import { createProject } from "../db/services/projects";
import { resetSeededTestDatabase } from "../test-db";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import { completeDevelopmentTaskHandoff } from "./development-task-worker-handoff";

async function createGitLabHandoffFixture() {
  await resetSeededTestDatabase();
  const projectResult = await createProject({
    name: `GitLab Development Task ${Date.now()}`,
    repoUrl: "https://gitlab.com/example/development-task-mr",
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create project.");
  }

  const queued = await queueDevelopmentTask({
    providerType: "gitlab",
    projectId: projectResult.project.id,
    repoFullName: "example/development-task-mr",
    externalIssueId: "gitlab-mr-task",
    issueNumber: 185,
    issueUrl: "https://gitlab.com/example/development-task-mr/-/issues/185",
    issueTitle: "Open a merge request from the runner",
    requestedByExternalUser: "octocat"
  });
  expect(queued.status).toBe("created");
  if (queued.status !== "created") {
    throw new Error("Expected development task to be created.");
  }

  const run = await createDevelopmentTaskRun({ taskId: queued.task.id });
  const root = await mkdtemp(`${tmpdir()}/daoflow-gitlab-handoff-`);
  const workspace = {
    codexHomePath: `${root}/codex-home`,
    configPath: `${root}/codex-home/config.toml`,
    repoPath: `${root}/repo`,
    artifactsPath: `${root}/artifacts`,
    logsPath: `${root}/logs`,
    promptPath: `${root}/artifacts/task-prompt.md`,
    runPlanPath: `${root}/artifacts/codex-run-plan.json`
  } satisfies PreparedDevelopmentTaskCodexWorkspace;
  await mkdir(workspace.logsPath, { recursive: true });

  return { project: projectResult.project, task: queued.task, run, workspace };
}

describe("development task worker handoff", () => {
  it("records GitLab merge request audit evidence when MR handoff is unavailable", async () => {
    const fixture = await createGitLabHandoffFixture();
    const pullRequestOpening = vi.fn();
    const previewQueuing = vi.fn();

    await completeDevelopmentTaskHandoff({
      ...fixture,
      githubTarget: null,
      metadata: {},
      codexExecution: {
        status: "ok",
        exitCode: 0,
        logPath: `${fixture.workspace.logsPath}/codex-exec.jsonl`
      },
      validation: {
        status: "ok",
        commands: [],
        logPath: `${fixture.workspace.logsPath}/validation.jsonl`
      },
      pullRequestOpening,
      previewQueuing
    });

    expect(pullRequestOpening).not.toHaveBeenCalled();
    expect(previewQueuing).not.toHaveBeenCalled();

    const [run] = await db
      .select()
      .from(developmentTaskRuns)
      .where(eq(developmentTaskRuns.id, fixture.run.id));
    expect(run).toMatchObject({
      status: "failed",
      failureCategory: "merge_request_failed",
      failureMessage: "GitLab merge request creation is not available for this task."
    });
    expect(run?.metadata).toMatchObject({
      mergeRequest: {
        status: "failed",
        logPath: `${fixture.workspace.logsPath}/merge-request.jsonl`,
        errorMessage: "GitLab merge request creation is not available for this task."
      }
    });

    const rows = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, `development_task/${fixture.task.id}`));
    expect(rows.map((row) => row.action)).toContain("development_task.merge_request.open");
    expect(
      rows.find((row) => row.action === "development_task.merge_request.open")?.metadata
    ).toMatchObject({
      providerType: "gitlab",
      mergeRequestUrl: null,
      errorMessage: "GitLab merge request creation is not available for this task."
    });
  });
});
