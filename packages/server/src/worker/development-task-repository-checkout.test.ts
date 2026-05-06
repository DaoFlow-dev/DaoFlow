import { mkdir, stat } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import type { projects } from "../db/schema/projects";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";
import { checkoutDevelopmentTaskRepository } from "./development-task-repository-checkout";

function taskFixture() {
  return {
    id: "task_checkout",
    providerInstallationId: null,
    repoFullName: "example/checkout",
    baseBranch: "feature/dev-task"
  } as typeof developmentTasks.$inferSelect;
}

function runFixture() {
  return {
    id: "run_checkout"
  } as typeof developmentTaskRuns.$inferSelect;
}

function projectFixture() {
  return {
    repoUrl: "https://example.com/example/checkout.git",
    repoFullName: "example/checkout",
    gitProviderId: null,
    gitInstallationId: null,
    defaultBranch: "main",
    config: {}
  } as typeof projects.$inferSelect;
}

describe("checkoutDevelopmentTaskRepository", () => {
  it("clones the task repository into the prepared workspace path", async () => {
    const workspaceRoot = path.join(tmpdir(), `daoflow-checkout-${Date.now()}`);
    await mkdir(workspaceRoot, { recursive: true });
    const repoPath = path.join(workspaceRoot, "repo");
    const artifactsPath = path.join(workspaceRoot, "artifacts");
    await Promise.all([mkdir(repoPath), mkdir(artifactsPath)]);
    const execRunner = vi.fn().mockResolvedValue({ exitCode: 0, signal: null });

    const result = await checkoutDevelopmentTaskRepository({
      task: taskFixture(),
      run: runFixture(),
      project: projectFixture(),
      repoPath,
      artifactsPath,
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "ok",
      repoPath,
      branch: "feature/dev-task",
      displayLabel: "example/checkout"
    });
    expect(execRunner).toHaveBeenCalledWith(
      "git",
      [
        "clone",
        "--depth",
        "1",
        "--branch",
        "feature/dev-task",
        "--single-branch",
        "--",
        "https://example.com/example/checkout.git",
        "."
      ],
      repoPath,
      expect.any(Function),
      undefined
    );
    await expect(stat(artifactsPath)).resolves.toBeTruthy();
  });

  it("reports clone failures without exposing credential material", async () => {
    const workspaceRoot = path.join(tmpdir(), `daoflow-checkout-fail-${Date.now()}`);
    await mkdir(workspaceRoot, { recursive: true });
    const repoPath = path.join(workspaceRoot, "repo");
    const artifactsPath = path.join(workspaceRoot, "artifacts");
    await Promise.all([mkdir(repoPath), mkdir(artifactsPath)]);
    const execRunner = vi.fn().mockResolvedValue({ exitCode: 128, signal: null });

    const result = await checkoutDevelopmentTaskRepository({
      task: taskFixture(),
      run: runFixture(),
      project: projectFixture(),
      repoPath,
      artifactsPath,
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "failed",
      repoPath,
      errorMessage: "git clone failed with exit code 128"
    });
    expect(JSON.stringify(result)).not.toContain("AUTHORIZATION");
  });
});
