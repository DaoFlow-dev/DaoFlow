import { mkdir, mkdtemp } from "node:fs/promises";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { describe, expect, it, vi } from "vitest";
import { db } from "../db/connection";
import { auditEntries } from "../db/schema/audit";
import { developmentTaskRuns } from "../db/schema/development-tasks";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { createDevelopmentTaskRun, queueDevelopmentTask } from "../db/services/development-tasks";
import { encodeGitInstallationPermissions } from "../db/services/git-providers";
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
  const suffix = `${Date.now()}`;
  const [provider] = await db
    .insert(gitProviders)
    .values({
      id: `gitprov_handoff_${suffix}`.slice(0, 32),
      type: "gitlab",
      name: `GitLab Handoff ${suffix}`,
      baseUrl: "https://gitlab.com",
      status: "active",
      updatedAt: new Date()
    })
    .returning();
  const [installation] = await db
    .insert(gitInstallations)
    .values({
      id: `gitinst_handoff_${suffix}`.slice(0, 32),
      providerId: provider.id,
      installationId: "example",
      accountName: "example",
      accountType: "organization",
      repositorySelection: "selected",
      permissions: encodeGitInstallationPermissions({ accessToken: "glpat-handoff" }),
      status: "active",
      updatedAt: new Date()
    })
    .returning();

  const queued = await queueDevelopmentTask({
    providerType: "gitlab",
    providerInstallationId: installation.id,
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

  return {
    project: projectResult.project,
    provider,
    installation,
    task: queued.task,
    run,
    workspace
  };
}

describe("development task worker handoff", () => {
  it("records GitLab merge request audit evidence when MR handoff is unavailable", async () => {
    const fixture = await createGitLabHandoffFixture();
    const pullRequestOpening = vi.fn();
    const previewQueuing = vi.fn();

    await completeDevelopmentTaskHandoff({
      ...fixture,
      reviewTarget: null,
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

  it("stores a successful GitLab merge request handoff without a GitHub comment", async () => {
    const fixture = await createGitLabHandoffFixture();
    const pullRequestOpening = vi
      .fn()
      .mockImplementation((input: { workspace: { logsPath: string } }) =>
        Promise.resolve({
          status: "ok" as const,
          branchName: "daoflow/issue-185-gitlab",
          commitSha: "abc123",
          pullRequestNumber: 7,
          pullRequestUrl: "https://gitlab.com/example/development-task-mr/-/merge_requests/7",
          logPath: `${input.workspace.logsPath}/merge-request.jsonl`
        })
      );
    const previewQueuing = vi.fn().mockResolvedValue({
      status: "skipped" as const,
      deployments: [],
      previewDeploymentId: undefined,
      previewUrl: undefined,
      message: "No preview target."
    });
    const fetchMock = vi.spyOn(globalThis, "fetch");

    await completeDevelopmentTaskHandoff({
      task: fixture.task,
      run: fixture.run,
      project: fixture.project,
      reviewTarget: {
        project: fixture.project,
        provider: fixture.provider,
        installation: fixture.installation
      },
      workspace: fixture.workspace,
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

    expect(fetchMock).not.toHaveBeenCalled();
    expect(previewQueuing).toHaveBeenCalledOnce();

    const [run] = await db
      .select()
      .from(developmentTaskRuns)
      .where(eq(developmentTaskRuns.id, fixture.run.id));
    expect(run).toMatchObject({
      status: "waiting_review",
      branchName: "daoflow/issue-185-gitlab",
      commitSha: "abc123",
      pullRequestNumber: 7,
      pullRequestUrl: "https://gitlab.com/example/development-task-mr/-/merge_requests/7"
    });
    expect(run?.metadata).toMatchObject({
      mergeRequest: {
        status: "ok",
        pullRequestUrl: "https://gitlab.com/example/development-task-mr/-/merge_requests/7",
        logPath: `${fixture.workspace.logsPath}/merge-request.jsonl`
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
      mergeRequestNumber: 7,
      mergeRequestUrl: "https://gitlab.com/example/development-task-mr/-/merge_requests/7"
    });
  });
});
