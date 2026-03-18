import { describe, expect, it, vi } from "vitest";
import { execStreaming, prepareClonedRepository, type LogLine } from "./docker-executor";

function createLogCollector() {
  const lines: LogLine[] = [];
  return {
    lines,
    onLog: (line: LogLine) => {
      lines.push(line);
    }
  };
}

describe("prepareClonedRepository", () => {
  it("runs recursive submodule and Git LFS hydration in order", async () => {
    const collector = createLogCollector();
    const execRunner = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, signal: null })
      .mockResolvedValueOnce({ exitCode: 0, signal: null })
      .mockResolvedValueOnce({ exitCode: 0, signal: null })
      .mockResolvedValueOnce({ exitCode: 0, signal: null })
      .mockResolvedValueOnce({ exitCode: 0, signal: null });

    const result = await prepareClonedRepository(
      "/tmp/daoflow-staging/test",
      collector.onLog,
      {
        repositoryPreparation: {
          submodules: true,
          gitLfs: true
        },
        gitConfigPath: "/tmp/daoflow-staging/test.gitconfig"
      },
      execRunner
    );

    expect(result).toEqual({ exitCode: 0 });
    const calls = execRunner.mock.calls as Parameters<typeof execStreaming>[];
    const commandCalls: Array<[string, string[]]> = calls.map((call) => [call[0], call[1]]);
    expect(commandCalls).toEqual([
      ["git", ["lfs", "version"]],
      ["git", ["submodule", "sync", "--recursive"]],
      ["git", ["submodule", "update", "--init", "--recursive", "--depth", "1"]],
      ["git", ["lfs", "pull"]],
      ["git", ["submodule", "foreach", "--recursive", "git lfs pull"]]
    ]);
    expect(
      calls.every((call) => {
        const env = call[4];
        return typeof env?.GIT_CONFIG_GLOBAL === "string";
      })
    ).toBe(true);
  });

  it("fails with a clear error when Git LFS is required but unavailable", async () => {
    const collector = createLogCollector();
    const execRunner = vi.fn().mockResolvedValueOnce({ exitCode: 1, signal: null });

    const result = await prepareClonedRepository(
      "/tmp/daoflow-staging/test",
      collector.onLog,
      {
        repositoryPreparation: {
          submodules: false,
          gitLfs: true
        }
      },
      execRunner
    );

    expect(result).toEqual({
      exitCode: 1,
      errorMessage:
        "Git LFS is required for this deployment source, but git-lfs is not available on the worker."
    });
  });
});
