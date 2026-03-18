import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildComposeCommandEnv,
  execStreaming,
  prepareClonedRepository,
  type LogLine
} from "./docker-executor";

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

describe("buildComposeCommandEnv", () => {
  const originalHome = process.env.HOME;
  const originalPath = process.env.PATH;
  const originalDockerConfig = process.env.DOCKER_CONFIG;
  const originalApiKey = process.env.API_KEY;
  let tempDir: string;

  afterEach(() => {
    if (originalHome === undefined) {
      delete process.env.HOME;
    } else {
      process.env.HOME = originalHome;
    }

    if (originalPath === undefined) {
      delete process.env.PATH;
    } else {
      process.env.PATH = originalPath;
    }

    if (originalDockerConfig === undefined) {
      delete process.env.DOCKER_CONFIG;
    } else {
      process.env.DOCKER_CONFIG = originalDockerConfig;
    }

    if (originalApiKey === undefined) {
      delete process.env.API_KEY;
    } else {
      process.env.API_KEY = originalApiKey;
    }

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("pins compose-managed values over ambient process env", () => {
    tempDir = mkdtempSync(join(tmpdir(), "daoflow-compose-env-"));
    writeFileSync(join(tempDir, ".daoflow.compose.env"), "API_KEY=file-value\n");

    process.env.HOME = "/tmp/daoflow-home";
    process.env.PATH = "/usr/bin:/bin";
    process.env.DOCKER_CONFIG = "/tmp/docker-config";
    process.env.API_KEY = "ambient-value";

    const env = buildComposeCommandEnv(tempDir, ".daoflow.compose.env");

    expect(env).toMatchObject({
      API_KEY: "file-value",
      DOCKER_CLI_HINTS: "false",
      DOCKER_CONFIG: "/tmp/docker-config",
      HOME: "/tmp/daoflow-home",
      PATH: "/usr/bin:/bin"
    });
    expect(env.API_KEY).toBe("file-value");
  });
});
