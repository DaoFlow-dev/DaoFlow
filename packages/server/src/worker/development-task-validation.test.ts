import { mkdir, readFile, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { execStreaming, OnLog } from "./docker-exec-shared";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import {
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

  it("runs validation commands in order and captures logs", async () => {
    const workspace = await validationWorkspace();
    const execRunner = vi.fn().mockImplementation((_command, _args, _cwd, onLog: OnLog) => {
      onLog({ stream: "stdout", message: "ok", timestamp: new Date(0) });
      return Promise.resolve({ exitCode: 0, signal: null });
    });

    const result = await runDevelopmentTaskValidation({
      workspace,
      commands: ["bun run lint", "bun run typecheck"],
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

  it("stops when a validation command fails", async () => {
    const workspace = await validationWorkspace();
    const execRunner = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, signal: null })
      .mockResolvedValueOnce({ exitCode: 2, signal: null });

    const result = await runDevelopmentTaskValidation({
      workspace,
      commands: ["bun run lint", "bun run typecheck", "bun run contracts:check"],
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
      sandbox: {
        containerName: "daoflow-devtask-validation",
        image: "ghcr.io/daoflow/codex-runner:test",
        cpuLimit: 1,
        memoryLimitMb: 768,
        timeoutMinutes: 2,
        networkPolicy: "default-egress",
        user: "1000:1000"
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
});
