import { mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { executeDevelopmentTaskCodex } from "./development-task-codex-execution";
import type { DevelopmentTaskCodexPlan } from "./development-task-codex-plan";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import type { execStreaming, OnLog } from "./docker-exec-shared";

type ExecRunnerCall = Parameters<typeof execStreaming>;

async function executionFixture() {
  const root = path.join(tmpdir(), `daoflow-codex-exec-${Date.now()}`);
  const repoPath = path.join(root, "repo");
  const logsPath = path.join(root, "logs");
  await Promise.all([mkdir(repoPath, { recursive: true }), mkdir(logsPath, { recursive: true })]);

  const workspace = {
    codexHomePath: path.join(root, "home/.codex"),
    configPath: path.join(root, "home/.codex/config.toml"),
    authJsonPath: path.join(root, "home/.codex/auth.json"),
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
    authJsonPath: path.join(workspace.codexHomePath, "auth.json"),
    repoPath,
    artifactsPath: workspace.artifactsPath,
    logsPath,
    codexAuthMode: "custom_provider_env",
    codexAuthJsonEnvKey: "CODEX_AUTH_JSON",
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

  it("runs host Docker sandboxes with bounded container options", async () => {
    const { plan, workspace } = await executionFixture();
    const execRunner = vi.fn().mockResolvedValue({ exitCode: 0, signal: null });

    const result = await executeDevelopmentTaskCodex({
      plan,
      workspace,
      sandbox: {
        containerName: "daoflow-devtask-run-exec",
        image: "ghcr.io/daoflow/codex-runner:test",
        cpuLimit: 2,
        memoryLimitMb: 1024,
        timeoutMinutes: 3,
        networkPolicy: "none"
      },
      onLog: vi.fn(),
      execRunner
    });

    expect(result.status).toBe("ok");
    const call = execRunner.mock.calls[0] as ExecRunnerCall | undefined;
    const command = call?.[0];
    const args = call?.[1] ?? [];
    const cwd = call?.[2];
    const env = call?.[4];
    const options = call?.[5];
    expect(command).toContain("docker");
    expect(cwd).toBe(process.env.GIT_WORK_DIR ?? "/tmp/daoflow-staging");
    expect(args).toEqual(
      expect.arrayContaining([
        "run",
        "--rm",
        "--name",
        "daoflow-devtask-run-exec",
        "--cpus",
        "2",
        "--memory",
        "1024m",
        "--pids-limit",
        "512",
        "--security-opt",
        "no-new-privileges",
        "--cap-drop",
        "ALL",
        "--network",
        "none",
        "ghcr.io/daoflow/codex-runner:test",
        "codex"
      ])
    );
    expect(args).toContain(
      `${path.dirname(workspace.repoPath)}:${path.dirname(workspace.repoPath)}`
    );
    expect(args).toContain(`CODEX_HOME=${workspace.codexHomePath}`);
    expect(env).toBeUndefined();
    expect(options).toMatchObject({ timeoutMs: 180_000 });
  });

  it("removes the host Docker container when the run is terminated", async () => {
    const { plan, workspace } = await executionFixture();
    const execRunner = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 1, signal: "SIGTERM" })
      .mockResolvedValueOnce({ exitCode: 0, signal: null });

    const result = await executeDevelopmentTaskCodex({
      plan,
      workspace,
      sandbox: {
        containerName: "daoflow-devtask-timeout",
        image: "ghcr.io/daoflow/codex-runner:test",
        cpuLimit: 1,
        memoryLimitMb: 512,
        timeoutMinutes: 1,
        networkPolicy: "default-egress"
      },
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "failed",
      errorMessage: "Codex terminated by signal SIGTERM"
    });
    expect(execRunner.mock.calls[1]?.[1]).toEqual(["rm", "-f", "daoflow-devtask-timeout"]);
  });
});
