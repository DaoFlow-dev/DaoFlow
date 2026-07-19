import { existsSync, readFileSync } from "node:fs";
import { mkdir, mkdtemp, readdir, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { projects } from "../db/schema/projects";
import type { developmentTaskRuns, developmentTasks } from "../db/schema/development-tasks";

let workspaceRoot = "";

afterEach(async () => {
  vi.restoreAllMocks();
  vi.doUnmock("./checkout-source");
  vi.resetModules();
  if (workspaceRoot) {
    await rm(workspaceRoot, { recursive: true, force: true });
    workspaceRoot = "";
  }
});

describe("checkoutDevelopmentTaskRepository custom CA", () => {
  it("removes the CA after repository preparation fails", async () => {
    vi.doMock("./checkout-source", () => ({
      resolveCheckoutSpec: vi.fn().mockResolvedValue({
        repoUrl: "https://git.example.test/team/repository.git",
        branch: "main",
        displayLabel: "team/repository",
        gitConfig: [],
        caCertificatePem: "-----BEGIN CERTIFICATE-----\nca\n-----END CERTIFICATE-----",
        repositoryPreparation: { submodules: false, gitLfs: true },
        requiresLocalMaterialization: true
      })
    }));
    const { checkoutDevelopmentTaskRepository } =
      await import("./development-task-repository-checkout");

    workspaceRoot = await mkdtemp(path.join(tmpdir(), "daoflow-task-checkout-ca-"));
    const repoPath = path.join(workspaceRoot, "repo");
    const artifactsPath = path.join(workspaceRoot, "artifacts");
    await Promise.all([mkdir(repoPath), mkdir(artifactsPath)]);
    const caPaths = new Set<string>();
    const execRunner = vi.fn(
      async (
        _command: string,
        args: string[],
        _cwd: string,
        _onLog: unknown,
        env?: Record<string, string>
      ) => {
        const configPath = env?.GIT_CONFIG_GLOBAL;
        expect(configPath).toBeTypeOf("string");
        const config = readFileSync(configPath as string, "utf8");
        const caPath = config.match(/sslCAInfo = (.+)/)?.[1];
        expect(caPath).toBeTypeOf("string");
        caPaths.add(caPath as string);
        expect(existsSync(caPath as string)).toBe(true);
        return { exitCode: args.join(" ") === "lfs version" ? 1 : 0, signal: null };
      }
    );

    const result = await checkoutDevelopmentTaskRepository({
      task: { id: "task_ca" } as typeof developmentTasks.$inferSelect,
      run: { id: "run_ca" } as typeof developmentTaskRuns.$inferSelect,
      project: { id: "project_ca" } as typeof projects.$inferSelect,
      repoPath,
      artifactsPath,
      onLog: vi.fn(),
      execRunner
    });

    expect(result).toMatchObject({
      status: "failed",
      errorMessage:
        "Git LFS is required for this deployment source, but git-lfs is not available on the worker."
    });
    expect(execRunner.mock.calls.map(([, args]) => args.join(" "))).toEqual([
      "clone --depth 1 --branch main --single-branch -- https://git.example.test/team/repository.git .",
      "lfs version"
    ]);
    expect(caPaths).toHaveLength(1);
    for (const caPath of caPaths) {
      expect(existsSync(caPath)).toBe(false);
      expect(existsSync(path.dirname(caPath))).toBe(false);
    }
    await expect(readdir(artifactsPath)).resolves.not.toContain("run_ca.gitconfig");
  });
});
