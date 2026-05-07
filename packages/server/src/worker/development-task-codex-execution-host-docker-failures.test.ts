import { mkdir } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { executeDevelopmentTaskCodex } from "./development-task-codex-execution";
import type { DevelopmentTaskCodexPlan } from "./development-task-codex-plan";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import type { execStreaming, OnLog } from "./docker-exec-shared";

type ExecRunnerCall = Parameters<typeof execStreaming>;

async function hostDockerFixture() {
  const root = path.join(tmpdir(), `daoflow-codex-host-docker-failure-${Date.now()}`);
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
    args: ["exec", "--json", "--cd", repoPath, "Do the task"],
    env: {
      CODEX_HOME: workspace.codexHomePath,
      DAOFLOW_TASK_ID: "task_host_docker_failure",
      DAOFLOW_RUN_ID: "run_host_docker_failure"
    },
    codexHomePath: workspace.codexHomePath,
    configPath: workspace.configPath,
    authJsonPath: workspace.authJsonPath,
    repoPath,
    artifactsPath: workspace.artifactsPath,
    logsPath,
    codexAuthMode: "custom_provider_env",
    codexAuthJsonEnvKey: "CODEX_AUTH_JSON",
    defaultCodexHomePath: "/runner/home/.codex",
    configToml: "",
    prompt: "Do the task"
  } satisfies DevelopmentTaskCodexPlan;

  return {
    plan,
    workspace,
    sandbox: {
      provider: "host_docker" as const,
      containerName: "daoflow-devtask-disk-full",
      image: "ghcr.io/daoflow-dev/codex-runner:test",
      cpuLimit: 2,
      memoryLimitMb: 1024,
      timeoutMinutes: 3,
      networkPolicy: "default-egress",
      user: "1000:1000",
      retainOnFailure: false
    }
  };
}

describe("executeDevelopmentTaskCodex host Docker failures", () => {
  it("turns Docker disk exhaustion into actionable operator guidance", async () => {
    const { plan, workspace, sandbox } = await hostDockerFixture();
    const execRunner = vi.fn((...call: ExecRunnerCall) => {
      const onLog: OnLog = call[3];
      onLog({
        stream: "stderr",
        message: "failed to register layer: write /usr/local/bin/bun: no space left on device",
        timestamp: new Date(0)
      });
      return Promise.resolve({ exitCode: 125, signal: null });
    });

    const result = await executeDevelopmentTaskCodex({
      plan,
      workspace,
      sandbox,
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "failed",
      exitCode: 125,
      errorMessage:
        "Host Docker sandbox failed because the Docker host is out of disk space. Free space or prune unused Docker images/build cache on the runner host, then retry."
    });
  });

  it("turns runner image pull failures into registry guidance", async () => {
    const { plan, workspace, sandbox } = await hostDockerFixture();
    const execRunner = vi.fn((...call: ExecRunnerCall) => {
      const onLog: OnLog = call[3];
      onLog({
        stream: "stderr",
        message:
          "Error response from daemon: pull access denied for ghcr.io/acme/missing-runner, repository does not exist",
        timestamp: new Date(0)
      });
      return Promise.resolve({ exitCode: 125, signal: null });
    });

    const result = await executeDevelopmentTaskCodex({
      plan,
      workspace,
      sandbox,
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "failed",
      exitCode: 125,
      errorMessage:
        "Host Docker sandbox could not pull the runner image. Check the runner image name, tag, and registry permissions."
    });
  });
});
