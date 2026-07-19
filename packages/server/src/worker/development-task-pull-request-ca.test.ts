import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { gitInstallations, gitProviders } from "../db/schema/git-providers";
import type { projects } from "../db/schema/projects";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";

let workspaceRoot = "";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.doUnmock("./checkout-source");
  vi.doUnmock("./development-task-pull-request-github");
  vi.resetModules();
  if (workspaceRoot) {
    await rm(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = "";
  }
});

describe("openGitHubDevelopmentTaskPullRequest custom CA", () => {
  it("removes the CA when the branch push fails", async () => {
    vi.doMock("./checkout-source", () => ({
      resolveCheckoutSpec: vi.fn().mockResolvedValue({
        repoUrl: "https://git.example.test/team/repository.git",
        branch: "main",
        displayLabel: "team/repository",
        gitConfig: [],
        caCertificatePem: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
        repositoryPreparation: { submodules: false, gitLfs: false },
        requiresLocalMaterialization: true
      })
    }));
    vi.doMock("./development-task-pull-request-github", () => ({
      buildDevelopmentTaskBranchName: vi.fn(() => "daoflow/issue-247-run-ca-task"),
      createGitHubDevelopmentTaskPullRequest: vi.fn()
    }));
    const { openGitHubDevelopmentTaskPullRequest } =
      await import("./development-task-pull-request");

    workspaceRoot = await mkdtemp(path.join(tmpdir(), "daoflow-task-pr-ca-"));
    const workspace = {
      codexHomePath: path.join(workspaceRoot, "codex-home"),
      configPath: path.join(workspaceRoot, "codex-home", "config.toml"),
      authJsonPath: path.join(workspaceRoot, "codex-home", "auth.json"),
      repoPath: path.join(workspaceRoot, "repo"),
      artifactsPath: path.join(workspaceRoot, "artifacts"),
      logsPath: path.join(workspaceRoot, "logs"),
      promptPath: path.join(workspaceRoot, "artifacts", "task-prompt.md"),
      runPlanPath: path.join(workspaceRoot, "artifacts", "codex-run-plan.json")
    } satisfies PreparedDevelopmentTaskCodexWorkspace;
    await Promise.all([
      mkdir(workspace.repoPath, { recursive: true }),
      mkdir(workspace.artifactsPath, { recursive: true }),
      mkdir(workspace.logsPath, { recursive: true })
    ]);
    const caPaths = new Set<string>();
    const execRunner = vi.fn(
      async (
        _command: string,
        args: string[],
        _cwd: string,
        onLog: (line: { stream: "stdout" | "stderr"; message: string; timestamp: Date }) => void,
        env?: Record<string, string>
      ) => {
        const configPath = env?.GIT_CONFIG_GLOBAL;
        expect(configPath).toBeTypeOf("string");
        const config = readFileSync(configPath as string, "utf8");
        const caPath = config.match(/sslCAInfo = (.+)/)?.[1];
        expect(caPath).toBeTypeOf("string");
        caPaths.add(caPath as string);
        expect(existsSync(caPath as string)).toBe(true);

        const command = args.join(" ");
        if (command === "diff --cached --quiet") return { exitCode: 1, signal: null };
        if (command === "diff --cached --stat") {
          onLog({ stream: "stdout", message: " README.md | 1 +", timestamp: new Date() });
        }
        if (command === "diff --cached --name-status") {
          onLog({ stream: "stdout", message: "M\tREADME.md", timestamp: new Date() });
        }
        if (command === "rev-parse HEAD") {
          onLog({ stream: "stdout", message: "abc123", timestamp: new Date() });
        }
        return { exitCode: command.startsWith("push ") ? 128 : 0, signal: null };
      }
    );

    const result = await openGitHubDevelopmentTaskPullRequest({
      task: {
        issueNumber: 247,
        issueTitle: "Push with custom CA",
        issueUrl: "https://git.example.test/team/repository/-/issues/247",
        repoFullName: "team/repository",
        baseBranch: "main"
      } as typeof developmentTasks.$inferSelect,
      run: { id: "run_ca" } as typeof developmentTaskRuns.$inferSelect,
      project: { id: "project_ca" } as typeof projects.$inferSelect,
      provider: { type: "github" } as typeof gitProviders.$inferSelect,
      installation: {} as typeof gitInstallations.$inferSelect,
      workspace,
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "failed",
      errorMessage: "git push failed with exit code 128"
    });
    expect(execRunner.mock.calls.at(-1)?.[1]).toEqual([
      "push",
      "--set-upstream",
      "origin",
      "HEAD:refs/heads/daoflow/issue-247-run-ca-task"
    ]);
    expect(caPaths).toHaveLength(1);
    for (const caPath of caPaths) {
      expect(existsSync(caPath)).toBe(false);
      expect(existsSync(path.dirname(caPath))).toBe(false);
    }
    await expect(readdir(workspace.artifactsPath)).resolves.not.toContain("run_ca.pr.gitconfig");
  });
});
