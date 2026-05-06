import { mkdir, mkdtemp, readdir, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { describe, expect, it, vi } from "vitest";
import type { gitInstallations, gitProviders } from "../db/schema/git-providers";
import type { projects } from "../db/schema/projects";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import { encodeGitInstallationPermissions } from "../db/services/git-providers";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import { openGitHubDevelopmentTaskPullRequest } from "./development-task-pull-request";

type GitExecRunner = NonNullable<
  Parameters<typeof openGitHubDevelopmentTaskPullRequest>[0]["execRunner"]
>;

describe("openGitHubDevelopmentTaskPullRequest for GitLab", () => {
  it("commits changes, pushes a task branch, and creates a GitLab MR", async () => {
    const root = await mkdtemp(`${tmpdir()}/daoflow-mr-workspace-`);
    const workspace = {
      codexHomePath: `${root}/codex-home`,
      configPath: `${root}/codex-home/config.toml`,
      repoPath: `${root}/repo`,
      artifactsPath: `${root}/artifacts`,
      logsPath: `${root}/logs`,
      promptPath: `${root}/artifacts/task-prompt.md`,
      runPlanPath: `${root}/artifacts/codex-run-plan.json`
    } satisfies PreparedDevelopmentTaskCodexWorkspace;
    await Promise.all([
      mkdir(workspace.repoPath, { recursive: true }),
      mkdir(workspace.artifactsPath, { recursive: true }),
      mkdir(workspace.logsPath, { recursive: true })
    ]);
    await writeFile(`${workspace.repoPath}/README.md`, "changed\n");

    const task = {
      issueNumber: 185,
      issueTitle: "Open a merge request from the runner",
      issueUrl: "https://gitlab.example.com/example/development-task-mr/-/issues/185",
      repoFullName: "example/development-task-mr",
      baseBranch: "main"
    } as typeof developmentTasks.$inferSelect;
    const run = { id: "run_gitlab_123456789" } as typeof developmentTaskRuns.$inferSelect;
    const project = {
      repoUrl: "https://gitlab.example.com/example/development-task-mr"
    } as typeof projects.$inferSelect;
    const provider = {
      type: "gitlab",
      baseUrl: "https://gitlab.example.com"
    } as typeof gitProviders.$inferSelect;
    const installation = {
      permissions: encodeGitInstallationPermissions({ accessToken: "glpat-open-mr" })
    } as typeof gitInstallations.$inferSelect;

    const fetchMock = vi.spyOn(globalThis, "fetch").mockImplementationOnce((_url, init) => {
      if (typeof init?.body !== "string") {
        throw new Error("Expected JSON merge request body.");
      }
      const body = JSON.parse(init.body) as {
        title?: string;
        source_branch?: string;
        target_branch?: string;
      };
      expect(body.title).toBe("DaoFlow task: Open a merge request from the runner");
      expect(body.source_branch).toMatch(/^daoflow\/issue-185-/);
      expect(body.target_branch).toBe("main");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            iid: 7,
            web_url: "https://gitlab.example.com/example/development-task-mr/-/merge_requests/7"
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
      task,
      run,
      project,
      provider,
      installation,
      workspace,
      validationStatus: "ok",
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "ok",
      commitSha: "abc123",
      logPath: `${workspace.logsPath}/merge-request.jsonl`,
      pullRequestNumber: 7,
      pullRequestUrl: "https://gitlab.example.com/example/development-task-mr/-/merge_requests/7"
    });
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock.mock.calls[0]?.[0]).toBe(
      "https://gitlab.example.com/api/v4/projects/example%2Fdevelopment-task-mr/merge_requests"
    );
    await expect(readdir(workspace.artifactsPath)).resolves.not.toContain(`${run.id}.pr.gitconfig`);
  });
});
