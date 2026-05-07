import { mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { execStreaming, OnLog } from "./docker-exec-shared";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import {
  readDevelopmentTaskAllowedCommands,
  readDevelopmentTaskValidationCommands,
  runDevelopmentTaskValidation
} from "./development-task-validation";

type ExecRunnerCall = Parameters<typeof execStreaming>;

async function validationWorkspace() {
  const root = path.join(tmpdir(), `daoflow-validation-${Date.now()}`);
  const repoPath = path.join(root, "repo");
  const logsPath = path.join(root, "logs");
  await Promise.all([mkdir(repoPath, { recursive: true }), mkdir(logsPath, { recursive: true })]);

  return {
    codexHomePath: path.join(root, "home/.codex"),
    configPath: path.join(root, "home/.codex/config.toml"),
    authJsonPath: path.join(root, "home/.codex/auth.json"),
    repoPath,
    artifactsPath: path.join(root, "artifacts"),
    logsPath,
    promptPath: path.join(root, "artifacts/task-prompt.md"),
    runPlanPath: path.join(root, "artifacts/codex-run-plan.json")
  } satisfies PreparedDevelopmentTaskCodexWorkspace;
}

describe("development task validation", () => {
  it("reads configured validation commands from run metadata", () => {
    expect(
      readDevelopmentTaskValidationCommands({
        validationCommands: ["bun run test:unit", "", 7, "bun run typecheck"]
      })
    ).toEqual(["bun run test:unit", "bun run typecheck"]);
  });

  it("reads configured allowed commands from run metadata", () => {
    expect(
      readDevelopmentTaskAllowedCommands({
        allowedCommands: ["bun run lint", "", 7, "bun run typecheck"]
      })
    ).toEqual(["bun run lint", "bun run typecheck"]);
  });

  it("runs validation commands in order and captures logs", async () => {
    const workspace = await validationWorkspace();
    const execRunner = vi.fn().mockImplementation((_command, _args, _cwd, onLog: OnLog) => {
      onLog({ stream: "stdout", message: "ok", timestamp: new Date(0) });
      return Promise.resolve({ exitCode: 0, signal: null });
    });

    const result = await runDevelopmentTaskValidation({
      workspace,
      commands: ["bun run lint", "bun run typecheck"],
      allowedCommands: ["bun run lint", "bun run typecheck"],
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "ok",
      commands: ["bun run lint", "bun run typecheck"],
      logPath: path.join(workspace.logsPath, "validation.jsonl")
    });
    expect(execRunner).toHaveBeenNthCalledWith(
      1,
      "sh",
      ["-lc", "bun run lint"],
      workspace.repoPath,
      expect.any(Function)
    );
    expect(execRunner).toHaveBeenNthCalledWith(
      2,
      "sh",
      ["-lc", "bun run typecheck"],
      workspace.repoPath,
      expect.any(Function)
    );
    expect(await readFile(result.logPath, "utf8")).toContain('"command":"bun run lint"');
    expect((await stat(result.logPath)).mode & 0o777).toBe(0o600);
  });

  it("blocks validation commands outside the runner allowlist", async () => {
    const workspace = await validationWorkspace();
    const execRunner = vi.fn();

    const result = await runDevelopmentTaskValidation({
      workspace,
      commands: ["bun run lint", "bun run secrets:dump"],
      allowedCommands: ["bun run lint", "bun run typecheck"],
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "failed",
      failedCommand: "bun run secrets:dump",
      errorMessage: "Validation command is not allowed by the runner policy: bun run secrets:dump"
    });
    expect(execRunner).not.toHaveBeenCalled();
  });

  it("fails closed when validation commands exist but the allowlist is empty", async () => {
    const workspace = await validationWorkspace();
    const execRunner = vi.fn();

    const result = await runDevelopmentTaskValidation({
      workspace,
      commands: ["bun run lint"],
      allowedCommands: [],
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "failed",
      failedCommand: "bun run lint",
      errorMessage: "Validation command is not allowed by the runner policy: bun run lint"
    });
    expect(execRunner).not.toHaveBeenCalled();
  });

  it("stops when a validation command fails", async () => {
    const workspace = await validationWorkspace();
    const execRunner = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, signal: null })
      .mockResolvedValueOnce({ exitCode: 2, signal: null });

    const result = await runDevelopmentTaskValidation({
      workspace,
      commands: ["bun run lint", "bun run typecheck", "bun run contracts:check"],
      allowedCommands: ["bun run lint", "bun run typecheck", "bun run contracts:check"],
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "failed",
      failedCommand: "bun run typecheck",
      exitCode: 2
    });
    expect(execRunner).toHaveBeenCalledTimes(2);
  });

  it("runs validation commands inside the host Docker sandbox", async () => {
    const workspace = await validationWorkspace();
    const execRunner = vi.fn().mockResolvedValue({ exitCode: 0, signal: null });

    const result = await runDevelopmentTaskValidation({
      workspace,
      commands: ["bun run test:unit"],
      allowedCommands: ["bun run test:unit"],
      sandbox: {
        provider: "host_docker",
        containerName: "daoflow-devtask-validation",
        image: "ghcr.io/daoflow/codex-runner:test",
        cpuLimit: 1,
        memoryLimitMb: 768,
        timeoutMinutes: 2,
        networkPolicy: "default-egress",
        user: "1000:1000",
        retainOnFailure: false
      },
      onLog: vi.fn(),
      execRunner
    });

    expect(result.status).toBe("ok");
    const call = execRunner.mock.calls[0] as ExecRunnerCall | undefined;
    const args = call?.[1] ?? [];
    expect(call?.[0]).toContain("docker");
    expect(args).toEqual(
      expect.arrayContaining([
        "run",
        "--rm",
        "--name",
        "daoflow-devtask-validation",
        "--memory",
        "768m",
        "--label",
        "dev.daoflow.sandbox.provider=host_docker",
        "--user",
        "1000:1000",
        "ghcr.io/daoflow/codex-runner:test",
        "sh",
        "-lc",
        "bun run test:unit"
      ])
    );
    expect(call?.[5]).toMatchObject({ timeoutMs: 120_000 });
  });

  it("cleans up retained validation sandboxes after successful commands", async () => {
    const workspace = await validationWorkspace();
    const execRunner = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, signal: null })
      .mockResolvedValueOnce({ exitCode: 0, signal: null });

    const result = await runDevelopmentTaskValidation({
      workspace,
      commands: ["bun run lint"],
      allowedCommands: ["bun run lint"],
      sandbox: {
        provider: "host_docker",
        containerName: "daoflow-devtask-validation-retained",
        image: "ghcr.io/daoflow/codex-runner:test",
        cpuLimit: 1,
        memoryLimitMb: 768,
        timeoutMinutes: 2,
        networkPolicy: "default-egress",
        user: "1000:1000",
        retainOnFailure: true
      },
      onLog: vi.fn(),
      execRunner
    });

    expect(result.status).toBe("ok");
    expect(execRunner.mock.calls[0]?.[1]).not.toContain("--rm");
    expect(execRunner.mock.calls[1]?.[1]).toEqual([
      "rm",
      "-f",
      "daoflow-devtask-validation-retained"
    ]);
  });
});
