import { generateKeyPairSync } from "node:crypto";
import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { eq } from "drizzle-orm";
import { afterEach, describe, expect, it, vi } from "vitest";
import { db } from "../db/connection";
import { encrypt } from "../db/crypto";
import { gitInstallations, gitProviders } from "../db/schema/git-providers";
import { projects } from "../db/schema/projects";
import { createDevelopmentTaskRun, queueDevelopmentTask } from "../db/services/development-tasks";
import { createProject } from "../db/services/projects";
import { resetSeededTestDatabase } from "../test-db";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import { openGitHubDevelopmentTaskPullRequest } from "./development-task-pull-request";

type GitExecRunner = NonNullable<
  Parameters<typeof openGitHubDevelopmentTaskPullRequest>[0]["execRunner"]
>;

async function createPullRequestFixture() {
  const suffix = `${Date.now()}`;
  const providerId = `gitprov_pr_${suffix}`.slice(0, 32);
  const installationId = `gitinst_pr_${suffix}`.slice(0, 32);
  const repoFullName = "example/development-task-pr";
  const projectResult = await createProject({
    name: `Development Task PR ${suffix}`,
    repoUrl: `https://github.com/${repoFullName}`,
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });

  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create project.");
  }

  const privateKeyPem = generateKeyPairSync("rsa", { modulusLength: 2048 })
    .privateKey.export({ format: "pem", type: "pkcs1" })
    .toString();

  const [provider] = await db
    .insert(gitProviders)
    .values({
      id: providerId,
      type: "github",
      name: `GitHub PR ${suffix}`,
      appId: "123456",
      privateKeyEncrypted: encrypt(privateKeyPem),
      webhookSecret: "github-pr-secret",
      status: "active",
      updatedAt: new Date()
    })
    .returning();

  const [installation] = await db
    .insert(gitInstallations)
    .values({
      id: installationId,
      providerId,
      installationId: "9107",
      accountName: "example",
      accountType: "organization",
      repositorySelection: "selected",
      status: "active",
      installedByUserId: "user_foundation_owner",
      updatedAt: new Date()
    })
    .returning();

  const [project] = await db
    .update(projects)
    .set({
      repoFullName,
      sourceType: "compose",
      gitProviderId: providerId,
      gitInstallationId: installationId,
      defaultBranch: "main",
      updatedAt: new Date()
    })
    .where(eq(projects.id, projectResult.project.id))
    .returning();

  const queued = await queueDevelopmentTask({
    providerType: "github",
    providerInstallationId: installation.id,
    projectId: project.id,
    repoFullName,
    externalIssueId: "pr-task-issue",
    issueNumber: 185,
    issueUrl: `https://github.com/${repoFullName}/issues/185`,
    issueTitle: "Open a pull request from the runner",
    requestedByExternalUser: "octocat"
  });
  expect(queued.status).toBe("created");
  if (queued.status !== "created") {
    throw new Error("Expected development task to be created.");
  }

  const run = await createDevelopmentTaskRun({
    taskId: queued.task.id,
    sandboxProvider: "host_docker"
  });
  const root = await mkdtemp(`${tmpdir()}/daoflow-pr-workspace-`);

  return {
    provider,
    installation,
    project,
    task: queued.task,
    run,
    workspace: {
      codexHomePath: `${root}/codex-home`,
      configPath: `${root}/codex-home/config.toml`,
      repoPath: `${root}/repo`,
      artifactsPath: `${root}/artifacts`,
      logsPath: `${root}/logs`,
      promptPath: `${root}/artifacts/task-prompt.md`,
      runPlanPath: `${root}/artifacts/codex-run-plan.json`
    } satisfies PreparedDevelopmentTaskCodexWorkspace
  };
}

describe("openGitHubDevelopmentTaskPullRequest", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("commits Codex changes, pushes a task branch, and creates a GitHub PR", async () => {
    await resetSeededTestDatabase();
    const fixture = await createPullRequestFixture();
    await Promise.all([
      mkdir(fixture.workspace.repoPath, { recursive: true }),
      mkdir(fixture.workspace.artifactsPath, { recursive: true }),
      mkdir(fixture.workspace.logsPath, { recursive: true })
    ]);
    await Promise.all([
      writeFile(`${fixture.workspace.repoPath}/README.md`, "changed\n"),
      writeFile(`${fixture.workspace.artifactsPath}/.keep`, ""),
      writeFile(`${fixture.workspace.logsPath}/.keep`, "")
    ]);

    const fetchMock = vi
      .spyOn(globalThis, "fetch")
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "ghs_checkout_token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ token: "ghs_pr_token" }), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      )
      .mockImplementationOnce((_url, init) => {
        if (typeof init?.body !== "string") {
          throw new Error("Expected JSON pull request body.");
        }

        const body = JSON.parse(init.body) as {
          title?: string;
          head?: string;
          base?: string;
          body?: string;
        };
        expect(body.title).toBe("DaoFlow task: Open a pull request from the runner");
        expect(body.head).toMatch(/^daoflow\/issue-185-/);
        expect(body.base).toBe("main");
        expect(body.body).toContain("Preview: pending");
        return Promise.resolve(
          new Response(
            JSON.stringify({
              number: 42,
              html_url: "https://github.com/example/development-task-pr/pull/42"
            }),
            {
              status: 201,
              headers: { "Content-Type": "application/json" }
            }
          )
        );
      });

    const execRunner = vi
      .fn<GitExecRunner>()
      .mockImplementation(
        (
          _command: string,
          args: string[],
          _cwd: string,
          onLog: (line: { stream: "stdout" | "stderr"; message: string; timestamp: Date }) => void
        ) => {
          if (args.join(" ") === "diff --cached --quiet") {
            return Promise.resolve({ exitCode: 1, signal: null });
          }
          if (args.join(" ") === "diff --cached --stat") {
            onLog({ stream: "stdout", message: " README.md | 1 +", timestamp: new Date() });
          }
          if (args.join(" ") === "diff --cached --name-status") {
            onLog({ stream: "stdout", message: "M\tREADME.md", timestamp: new Date() });
          }
          if (args.join(" ") === "rev-parse HEAD") {
            onLog({ stream: "stdout", message: "abc123", timestamp: new Date() });
          }
          return Promise.resolve({ exitCode: 0, signal: null });
        }
      );

    const result = await openGitHubDevelopmentTaskPullRequest({
      task: fixture.task,
      run: fixture.run,
      project: fixture.project,
      provider: fixture.provider,
      installation: fixture.installation,
      workspace: fixture.workspace,
      validationStatus: "ok",
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "ok",
      commitSha: "abc123",
      changedFiles: [{ path: "README.md", status: "M" }],
      diffStat: "README.md | 1 +",
      pullRequestNumber: 42,
      pullRequestUrl: "https://github.com/example/development-task-pr/pull/42"
    });
    const gitCommands = execRunner.mock.calls.map(([, args]) => args.join(" "));
    expect(gitCommands).toEqual([
      "checkout -B daoflow/issue-185-" +
        fixture.run.id.slice(0, 8) +
        "-open-a-pull-request-from-the-runner",
      "config user.name DaoFlow",
      "config user.email daoflow-bot@daoflow.local",
      "add -A",
      "diff --cached --quiet",
      "diff --cached --stat",
      "diff --cached --name-status",
      "commit -m chore: address development task #185",
      "rev-parse HEAD",
      "push --set-upstream origin HEAD:refs/heads/" + result.branchName
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(3);
    await expect(readdir(fixture.workspace.artifactsPath)).resolves.not.toContain(
      `${fixture.run.id}.pr.gitconfig`
    );
  });
});
