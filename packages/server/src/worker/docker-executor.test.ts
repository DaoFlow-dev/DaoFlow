import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  buildComposeCommandEnv,
  dockerComposeBuild,
  dockerComposePs,
  dockerComposeDown,
  cleanupStagingDir,
  dockerComposePull,
  dockerComposeUp,
  execStreaming,
  gitClone,
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
  const originalAmbientOnly = process.env.AMBIENT_ONLY;
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

    if (originalAmbientOnly === undefined) {
      delete process.env.AMBIENT_ONLY;
    } else {
      process.env.AMBIENT_ONLY = originalAmbientOnly;
    }

    if (tempDir) {
      rmSync(tempDir, { recursive: true, force: true });
    }
  });

  it("pins compose-managed values over ambient process env without leaking unrelated host env", () => {
    tempDir = mkdtempSync(join(tmpdir(), "daoflow-compose-env-"));
    writeFileSync(
      join(tempDir, ".daoflow.compose.env"),
      'API_KEY="file-value$$suffix"\nLITERAL_SECRET="postgres://user:p@ss$$word@db/app"\n'
    );

    process.env.HOME = "/tmp/daoflow-home";
    process.env.PATH = "/usr/bin:/bin";
    process.env.DOCKER_CONFIG = "/tmp/docker-config";
    process.env.API_KEY = "ambient-value";
    process.env.AMBIENT_ONLY = "should-not-leak";

    const env = buildComposeCommandEnv(tempDir, ".daoflow.compose.env");

    expect(env).toMatchObject({
      API_KEY: "file-value$$suffix",
      DOCKER_CLI_HINTS: "false",
      DOCKER_CONFIG: "/tmp/docker-config",
      HOME: "/tmp/daoflow-home",
      LITERAL_SECRET: "postgres://user:p@ss$$word@db/app",
      PATH: "/usr/bin:/bin"
    });
    expect(env.API_KEY).toBe("file-value$$suffix");
    expect(env.AMBIENT_ONLY).toBeUndefined();
  });
});

describe("gitClone", () => {
  it("pins the checkout to a recorded commit when one is provided", async () => {
    const collector = createLogCollector();
    const deploymentId = "pin-commit-checkout";
    const execRunner = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, signal: null })
      .mockResolvedValueOnce({ exitCode: 0, signal: null })
      .mockResolvedValueOnce({ exitCode: 0, signal: null });

    try {
      const result = await gitClone(
        "https://example.com/org/repo.git",
        "main",
        deploymentId,
        collector.onLog,
        {
          commitSha: "abcdef1234567890abcdef1234567890abcdef12"
        },
        execRunner
      );

      expect(result).toMatchObject({
        exitCode: 0
      });
      const commandCalls = (execRunner.mock.calls as Parameters<typeof execStreaming>[]).map(
        (call) => [call[0], call[1]]
      );
      expect(commandCalls).toEqual([
        [
          "git",
          [
            "clone",
            "--depth",
            "1",
            "--branch",
            "main",
            "--single-branch",
            "--",
            "https://example.com/org/repo.git",
            "."
          ]
        ],
        ["git", ["fetch", "--depth", "1", "origin", "abcdef1234567890abcdef1234567890abcdef12"]],
        ["git", ["checkout", "--detach", "abcdef1234567890abcdef1234567890abcdef12"]]
      ]);
    } finally {
      cleanupStagingDir(deploymentId);
    }
  });
});

describe("dockerComposePull", () => {
  it("scopes pull execution to the selected compose service", async () => {
    const collector = createLogCollector();
    process.env.PATH = "/usr/bin:/bin";
    const execRunner = vi.fn().mockResolvedValueOnce({ exitCode: 0, signal: null });

    await dockerComposePull(
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/demo",
      collector.onLog,
      ".daoflow.compose.env",
      "api",
      execRunner
    );

    expect(execRunner).toHaveBeenCalledWith(
      "docker",
      [
        "compose",
        "-f",
        ".daoflow.compose.rendered.yaml",
        "-p",
        "demo",
        "--env-file",
        ".daoflow.compose.env",
        "pull",
        "--ignore-buildable",
        "--include-deps",
        "api"
      ],
      "/tmp/demo",
      collector.onLog,
      expect.objectContaining({
        DOCKER_CLI_HINTS: "false"
      }),
      {
        inheritParentEnv: false
      }
    );
    expect(
      collector.lines.some((line) =>
        line.message.includes("Compose execution env isolated from ambient worker env")
      )
    ).toBe(true);
  });
});

describe("dockerComposeBuild", () => {
  it("enables BuildKit and scopes build execution to the selected compose service", async () => {
    const collector = createLogCollector();
    process.env.PATH = "/usr/bin:/bin";
    const execRunner = vi.fn().mockResolvedValueOnce({ exitCode: 0, signal: null });

    await dockerComposeBuild(
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/demo",
      collector.onLog,
      ".daoflow.compose.env",
      "api",
      execRunner
    );

    expect(execRunner).toHaveBeenCalledWith(
      "docker",
      [
        "compose",
        "-f",
        ".daoflow.compose.rendered.yaml",
        "-p",
        "demo",
        "--env-file",
        ".daoflow.compose.env",
        "build",
        "--with-dependencies",
        "api"
      ],
      "/tmp/demo",
      collector.onLog,
      expect.objectContaining({
        DOCKER_CLI_HINTS: "false",
        DOCKER_BUILDKIT: "1",
        COMPOSE_DOCKER_CLI_BUILD: "1"
      }),
      {
        inheritParentEnv: false
      }
    );
    expect(
      collector.lines.some((line) =>
        line.message.includes("Compose execution env isolated from ambient worker env")
      )
    ).toBe(true);
  });
});

describe("dockerComposeUp", () => {
  it("scopes up execution to the selected compose service", async () => {
    const collector = createLogCollector();
    process.env.PATH = "/usr/bin:/bin";
    const execRunner = vi.fn().mockResolvedValueOnce({ exitCode: 0, signal: null });

    await dockerComposeUp(
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/demo",
      collector.onLog,
      ".daoflow.compose.env",
      "api",
      execRunner
    );

    expect(execRunner).toHaveBeenCalledWith(
      "docker",
      [
        "compose",
        "-f",
        ".daoflow.compose.rendered.yaml",
        "-p",
        "demo",
        "--env-file",
        ".daoflow.compose.env",
        "up",
        "-d",
        "--remove-orphans",
        "api"
      ],
      "/tmp/demo",
      collector.onLog,
      expect.objectContaining({
        DOCKER_CLI_HINTS: "false"
      }),
      {
        inheritParentEnv: false
      }
    );
  });
});

describe("dockerComposePs", () => {
  it("reads machine-readable compose status for the selected service", async () => {
    const collector = createLogCollector();
    const execRunner = vi
      .fn()
      .mockImplementationOnce((_command, _args, _cwd, onLog: (line: LogLine) => void) => {
        onLog({
          stream: "stdout",
          message: JSON.stringify({
            Service: "api",
            Name: "demo-api-1",
            State: "running",
            Status: "Up 2 seconds (healthy)",
            Health: "healthy",
            ExitCode: 0
          }),
          timestamp: new Date()
        });
        return Promise.resolve({ exitCode: 0, signal: null });
      });

    const result = await dockerComposePs(
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/demo",
      collector.onLog,
      ".daoflow.compose.env",
      "api",
      execRunner
    );

    expect(execRunner).toHaveBeenCalledWith(
      "docker",
      [
        "compose",
        "-f",
        ".daoflow.compose.rendered.yaml",
        "-p",
        "demo",
        "--env-file",
        ".daoflow.compose.env",
        "ps",
        "--format",
        "json",
        "api"
      ],
      "/tmp/demo",
      expect.any(Function),
      expect.objectContaining({
        DOCKER_CLI_HINTS: "false"
      }),
      {
        inheritParentEnv: false
      }
    );
    expect(result).toEqual({
      exitCode: 0,
      statuses: [
        {
          service: "api",
          name: "demo-api-1",
          state: "running",
          status: "Up 2 seconds (healthy)",
          health: "healthy",
          exitCode: 0
        }
      ]
    });
  });
});

describe("dockerComposeDown", () => {
  it("stops compose services with the same isolated env contract", async () => {
    const collector = createLogCollector();
    process.env.PATH = "/usr/bin:/bin";
    const execRunner = vi.fn().mockResolvedValueOnce({ exitCode: 0, signal: null });

    await dockerComposeDown(
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/demo",
      collector.onLog,
      ".daoflow.compose.env",
      execRunner
    );

    expect(execRunner).toHaveBeenCalledWith(
      "docker",
      [
        "compose",
        "-f",
        ".daoflow.compose.rendered.yaml",
        "-p",
        "demo",
        "--env-file",
        ".daoflow.compose.env",
        "down"
      ],
      "/tmp/demo",
      collector.onLog,
      expect.objectContaining({
        DOCKER_CLI_HINTS: "false"
      }),
      {
        inheritParentEnv: false
      }
    );
  });
});
