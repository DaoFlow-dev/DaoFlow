import { mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { executeDevelopmentTaskCodex } from "./development-task-codex-execution";
import type { DevelopmentTaskCodexPlan } from "./development-task-codex-plan";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import type { OnLog } from "./docker-exec-shared";

async function executionFixture() {
  const root = path.join(tmpdir(), `daoflow-codex-exec-${Date.now()}`);
  const repoPath = path.join(root, "repo");
  const logsPath = path.join(root, "logs");
  await Promise.all([mkdir(repoPath, { recursive: true }), mkdir(logsPath, { recursive: true })]);

  const workspace = {
    codexHomePath: path.join(root, "home/.codex"),
    configPath: path.join(root, "home/.codex/config.toml"),
    repoPath,
    artifactsPath: path.join(root, "artifacts"),
    logsPath,
    promptPath: path.join(root, "artifacts/task-prompt.md"),
    runPlanPath: path.join(root, "artifacts/codex-run-plan.json")
  } satisfies PreparedDevelopmentTaskCodexWorkspace;
  const plan = {
    command: "codex",
    args: ["exec", "--json", "--profile", "daoflow", "--cd", repoPath, "Do the task"],
    env: {
      CODEX_HOME: workspace.codexHomePath,
      DAOFLOW_TASK_ID: "task_exec",
      DAOFLOW_RUN_ID: "run_exec"
    },
    codexHomePath: workspace.codexHomePath,
    configPath: workspace.configPath,
    repoPath,
    artifactsPath: workspace.artifactsPath,
    logsPath,
    defaultCodexHomePath: "/runner/home/.codex",
    configToml: "",
    prompt: "Do the task"
  } satisfies DevelopmentTaskCodexPlan;

  return { plan, workspace };
}

describe("executeDevelopmentTaskCodex", () => {
  it("runs the planned Codex command and records JSONL logs", async () => {
    const { plan, workspace } = await executionFixture();
    const onLog = vi.fn();
    const execRunner = vi.fn().mockImplementation((_command, _args, _cwd, log: OnLog) => {
      log({ stream: "stdout", message: '{"type":"started"}', timestamp: new Date(0) });
      return Promise.resolve({ exitCode: 0, signal: null });
    });

    const result = await executeDevelopmentTaskCodex({
      plan,
      workspace,
      onLog,
      execRunner
    });

    expect(result).toMatchObject({
      status: "ok",
      exitCode: 0,
      logPath: path.join(workspace.logsPath, "codex-exec.jsonl")
    });
    expect(execRunner).toHaveBeenCalledWith(
      "codex",
      plan.args,
      workspace.repoPath,
      expect.any(Function),
      plan.env
    );
    expect(onLog).toHaveBeenCalledOnce();
    const log = await readFile(result.logPath, "utf8");
    expect(log).toContain('"message":"{\\"type\\":\\"started\\"}"');
    expect((await stat(result.logPath)).mode & 0o777).toBe(0o600);
  });

  it("returns a failed result when Codex exits non-zero", async () => {
    const { plan, workspace } = await executionFixture();
    const execRunner = vi.fn().mockResolvedValue({ exitCode: 17, signal: null });

    const result = await executeDevelopmentTaskCodex({
      plan,
      workspace,
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "failed",
      exitCode: 17,
      errorMessage: "Codex exited with code 17"
    });
  });
});
