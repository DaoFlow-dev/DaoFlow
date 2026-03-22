import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

const mockedModuleIds = [
  "./docker-executor",
  "./ssh-executor",
  "./checkout-source",
  "./uploaded-artifacts"
] as const;

describe("prepareComposeWorkspace", () => {
  let stageDir: string;

  beforeEach(() => {
    stageDir = mkdtempSync(join(tmpdir(), "daoflow-compose-workspace-"));
    writeFileSync(
      join(stageDir, "compose.yaml"),
      [
        "services:",
        "  app:",
        "    image: nginx:alpine",
        "    env_file:",
        "      - ./config/runtime.env"
      ].join("\n")
    );
    writeFileSync(join(stageDir, "context.tar.gz"), "placeholder archive");
    vi.resetModules();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    for (const moduleId of mockedModuleIds) {
      vi.doUnmock(moduleId);
    }
    vi.resetModules();
    rmSync(stageDir, { recursive: true, force: true });
  });

  it("extracts uploaded remote context locally and uploads frozen env_file artifacts", async () => {
    const callOrder: string[] = [];

    vi.doMock("./docker-executor", () => ({
      createTarArchive: vi.fn(),
      ensureStagingDir: vi.fn(() => stageDir),
      extractTarArchive: vi.fn((_archivePath: string, destinationDir: string) => {
        callOrder.push("extract-local-context");
        mkdirSync(join(destinationDir, "config"), { recursive: true });
        writeFileSync(join(destinationDir, ".env"), "FROM_ARCHIVE=1\n");
        writeFileSync(join(destinationDir, "config", "runtime.env"), "API_TOKEN=secret\n");
        return { exitCode: 0 };
      }),
      getStagingArchivePath: vi.fn(),
      gitClone: vi.fn()
    }));

    vi.doMock("./ssh-executor", () => ({
      remoteEnsureDir: vi.fn((_ssh: unknown, dir: string) => {
        callOrder.push(`remote-ensure:${dir}`);
        return { exitCode: 0 };
      }),
      remoteExtractArchive: vi.fn(() => {
        callOrder.push("remote-extract");
        return { exitCode: 0 };
      }),
      scpUpload: vi.fn((_ssh: unknown, localPath: string) => {
        callOrder.push(`upload:${relative(stageDir, localPath)}`);
        return { exitCode: 0 };
      })
    }));

    vi.doMock("./checkout-source", () => ({
      resolveCheckoutSpec: vi.fn()
    }));

    const { prepareComposeWorkspace } = await import("./compose-workspace");

    const workspace = await prepareComposeWorkspace(
      "deploy_123",
      {
        deploymentSource: "uploaded-context",
        uploadedComposeFileName: "compose.yaml",
        uploadedContextArchiveName: "context.tar.gz"
      },
      {
        mode: "remote",
        ssh: {
          serverName: "deploy-target",
          host: "example.com",
          port: 22
        },
        remoteWorkDir: "/tmp/daoflow-staging/deploy_123"
      },
      () => {}
    );

    expect(callOrder.indexOf("extract-local-context")).toBeGreaterThan(-1);
    expect(callOrder.indexOf("extract-local-context")).toBeLessThan(
      callOrder.indexOf("upload:context.tar.gz")
    );
    expect(callOrder).toContain("upload:.daoflow.compose.rendered.yaml");
    expect(callOrder).toContain("upload:.daoflow.compose.inputs/config__runtime.env");
    expect(callOrder).toContain("upload:.daoflow.compose.env");
    expect(callOrder).toContain("upload:.daoflow.compose.export.sh");
    expect(workspace.composeFile).toBe(".daoflow.compose.rendered.yaml");
    expect(workspace.composeEnv.composeEnv.counts.repoDefaults).toBe(1);
    expect(workspace.composeEnv.payloadEntries.map((entry) => entry.key)).toEqual(["FROM_ARCHIVE"]);
    expect(workspace.composeInputs.manifest.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "service-env-file",
          path: ".daoflow.compose.inputs/config__runtime.env"
        })
      ])
    );
  });

  it("restores replayed uploaded artifacts into a fresh staging directory", async () => {
    const restoreUploadedArtifacts = vi.fn(({ destinationDir }: { destinationDir: string }) => {
      writeFileSync(
        join(destinationDir, "compose.yaml"),
        [
          "services:",
          "  app:",
          "    image: nginx:alpine",
          "    env_file:",
          "      - ./config/runtime.env"
        ].join("\n")
      );
      writeFileSync(join(destinationDir, "context.tar.gz"), "placeholder archive");
      mkdirSync(join(destinationDir, "config"), { recursive: true });
      writeFileSync(join(destinationDir, ".env"), "FROM_RESTORED=1\n");
      writeFileSync(join(destinationDir, "config", "runtime.env"), "API_TOKEN=secret\n");
      return { restoredFiles: ["compose.yaml", "context.tar.gz"] };
    });

    vi.doMock("./docker-executor", () => ({
      createTarArchive: vi.fn(),
      ensureStagingDir: vi.fn(() => stageDir),
      extractTarArchive: vi.fn(() => ({ exitCode: 0 })),
      getStagingArchivePath: vi.fn(),
      gitClone: vi.fn()
    }));

    vi.doMock("./ssh-executor", () => ({
      remoteEnsureDir: vi.fn(),
      remoteExtractArchive: vi.fn(),
      scpUpload: vi.fn()
    }));

    vi.doMock("./checkout-source", () => ({
      resolveCheckoutSpec: vi.fn()
    }));

    vi.doMock("./uploaded-artifacts", () => ({
      restoreUploadedArtifacts
    }));

    const { prepareComposeWorkspace } = await import("./compose-workspace");

    const workspace = await prepareComposeWorkspace(
      "deploy_replay",
      {
        deploymentSource: "uploaded-context",
        uploadedArtifactId: "0123456789abcdef0123456789abcdef",
        uploadedComposeFileName: "compose.yaml",
        uploadedContextArchiveName: "context.tar.gz"
      },
      { mode: "local" },
      () => {}
    );

    expect(restoreUploadedArtifacts).toHaveBeenCalledWith({
      artifactId: "0123456789abcdef0123456789abcdef",
      destinationDir: stageDir,
      composeFileName: "compose.yaml",
      contextArchiveName: "context.tar.gz"
    });
    expect(workspace.composeEnv.payloadEntries.map((entry) => entry.key)).toEqual([
      "FROM_RESTORED"
    ]);
    expect(workspace.composeInputs.manifest.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "service-env-file",
          path: ".daoflow.compose.inputs/config__runtime.env"
        })
      ])
    );
  });

  it("renders git-backed compose deployments through the frozen compose manifest", async () => {
    mkdirSync(join(stageDir, "ops", "config"), { recursive: true });
    writeFileSync(join(stageDir, "ops", ".env"), "ROOT_ONLY=1\n");
    writeFileSync(join(stageDir, "ops", "config", "runtime.env"), "RUNTIME_ONLY=1\n");
    writeFileSync(
      join(stageDir, "ops", "compose.yaml"),
      [
        "services:",
        "  app:",
        "    image: nginx:alpine",
        "    env_file:",
        "      - ./config/runtime.env"
      ].join("\n")
    );

    const gitClone = vi.fn(() => ({
      exitCode: 0,
      workDir: stageDir
    }));

    vi.doMock("./docker-executor", () => ({
      createTarArchive: vi.fn(),
      ensureStagingDir: vi.fn(() => stageDir),
      extractTarArchive: vi.fn(),
      getStagingArchivePath: vi.fn(),
      gitClone
    }));

    vi.doMock("./ssh-executor", () => ({
      remoteEnsureDir: vi.fn(),
      remoteExtractArchive: vi.fn(),
      scpUpload: vi.fn()
    }));

    vi.doMock("./checkout-source", () => ({
      resolveCheckoutSpec: vi.fn(() => ({
        repoUrl: "https://example.com/org/repo.git",
        branch: "main",
        displayLabel: "org/repo",
        gitConfig: [],
        repositoryPreparation: {
          submodules: false,
          gitLfs: false
        },
        requiresLocalMaterialization: false
      }))
    }));

    const { prepareComposeWorkspace } = await import("./compose-workspace");

    const workspace = await prepareComposeWorkspace(
      "deploy_456",
      {
        repoUrl: "https://example.com/org/repo.git",
        branch: "main",
        composeFilePath: "ops/compose.yaml",
        composeImageOverride: {
          serviceName: "app",
          imageReference: "ghcr.io/daoflow/control-plane:2.0.0"
        }
      },
      { mode: "local" },
      () => {},
      undefined,
      "abcdef1234567890abcdef1234567890abcdef12"
    );

    expect(gitClone).toHaveBeenCalledWith(
      "https://example.com/org/repo.git",
      "main",
      "deploy_456",
      expect.any(Function),
      expect.objectContaining({
        commitSha: "abcdef1234567890abcdef1234567890abcdef12"
      })
    );
    expect(workspace.composeFile).toBe(".daoflow.compose.rendered.yaml");
    expect(workspace.composeEnv.payloadEntries.map((entry) => entry.key)).toEqual(["ROOT_ONLY"]);
    expect(workspace.composeInputs.manifest.entries).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          kind: "service-env-file",
          path: ".daoflow.compose.inputs/config__runtime.env",
          sourcePath: "config/runtime.env"
        })
      ])
    );

    const renderedCompose = readFileSync(join(stageDir, workspace.composeFile), "utf8");
    expect(renderedCompose).toContain("image: ghcr.io/daoflow/control-plane:2.0.0");
    expect(renderedCompose).toContain(".daoflow.compose.inputs/config__runtime.env");
  });

  it("rewrites git-backed build contexts and secret file paths for the frozen compose workspace", async () => {
    mkdirSync(join(stageDir, "ops", "config"), { recursive: true });
    mkdirSync(join(stageDir, "ops", "secrets"), { recursive: true });
    mkdirSync(join(stageDir, "ops", "data"), { recursive: true });
    writeFileSync(join(stageDir, "ops", ".env"), "ROOT_ONLY=1\n");
    writeFileSync(join(stageDir, "ops", "config", "runtime.env"), "RUNTIME_ONLY=1\n");
    writeFileSync(join(stageDir, "ops", "config", "runtime.conf"), "listen=0.0.0.0\n");
    writeFileSync(join(stageDir, "ops", "secrets", "npm.token"), "token-value\n");
    writeFileSync(join(stageDir, "Dockerfile"), "FROM node:22-alpine\n");
    writeFileSync(
      join(stageDir, "ops", "compose.yaml"),
      [
        "services:",
        "  app:",
        "    build:",
        "      context: .",
        "      dockerfile: ../Dockerfile",
        "      secrets:",
        "        - source: npm_token",
        "          target: npm_token",
        "    configs:",
        "      - runtime_cfg",
        "    env_file:",
        "      - ./config/runtime.env",
        "    volumes:",
        "      - ./data:/var/lib/app",
        "configs:",
        "  runtime_cfg:",
        "    file: ./config/runtime.conf",
        "secrets:",
        "  npm_token:",
        "    file: ./secrets/npm.token"
      ].join("\n")
    );

    vi.doMock("./docker-executor", () => ({
      createTarArchive: vi.fn(),
      ensureStagingDir: vi.fn(() => stageDir),
      extractTarArchive: vi.fn(),
      getStagingArchivePath: vi.fn(),
      gitClone: vi.fn(() => ({
        exitCode: 0,
        workDir: stageDir
      }))
    }));

    vi.doMock("./ssh-executor", () => ({
      remoteEnsureDir: vi.fn(),
      remoteExtractArchive: vi.fn(),
      scpUpload: vi.fn()
    }));

    vi.doMock("./checkout-source", () => ({
      resolveCheckoutSpec: vi.fn(() => ({
        repoUrl: "https://example.com/org/repo.git",
        branch: "main",
        displayLabel: "org/repo",
        gitConfig: [],
        repositoryPreparation: {
          submodules: false,
          gitLfs: false
        },
        requiresLocalMaterialization: false
      }))
    }));

    const { prepareComposeWorkspace } = await import("./compose-workspace");

    const workspace = await prepareComposeWorkspace(
      "deploy_build_456",
      {
        repoUrl: "https://example.com/org/repo.git",
        branch: "main",
        composeFilePath: "ops/compose.yaml"
      },
      { mode: "local" },
      () => {}
    );

    const renderedCompose = readFileSync(join(stageDir, workspace.composeFile), "utf8");
    const exportedEnv = readFileSync(join(stageDir, ".daoflow.compose.export.sh"), "utf8");

    expect(renderedCompose).toContain("context: ops");
    expect(renderedCompose).toContain("dockerfile: ../Dockerfile");
    expect(renderedCompose).toContain("file: ops/config/runtime.conf");
    expect(renderedCompose).toContain("file: ops/secrets/npm.token");
    expect(renderedCompose).toContain("ops/data:/var/lib/app");
    expect(exportedEnv).toContain("export ROOT_ONLY='1'");
    expect(workspace.composeBuildPlan).toMatchObject({
      strategy: "build-only",
      services: [
        {
          serviceName: "app",
          context: "ops",
          dockerfile: "../Dockerfile",
          secrets: [
            {
              sourceName: "npm_token",
              provider: "file",
              reference: "ops/secrets/npm.token",
              target: "npm_token"
            }
          ]
        }
      ],
      graphServices: [
        {
          serviceName: "app",
          configs: [
            {
              sourceName: "runtime_cfg",
              provider: "file",
              reference: "ops/config/runtime.conf",
              target: null
            }
          ]
        }
      ],
      configs: [
        {
          name: "runtime_cfg",
          provider: "file",
          reference: "ops/config/runtime.conf"
        }
      ]
    });
  });
});
