import { createReadStream } from "node:fs";
import { mkdir, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { Readable } from "node:stream";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import type { Sandbox, SandboxProvider } from "@sandbank.dev/core";
import { describe, expect, it } from "vitest";
import type { PreparedDevelopmentTaskCodexWorkspace } from "./development-task-codex-workspace";
import {
  buildSandbankBoxLiteSandboxFromRun,
  runSandbankBoxLiteCommand
} from "./development-task-sandbank-boxlite";

const execFileAsync = promisify(execFile);

async function tarDirectory(root: string) {
  const archiveDir = await mkdtemp(path.join(tmpdir(), "daoflow-boxlite-test-archive-"));
  const archivePath = path.join(archiveDir, "workspace.tar");
  await execFileAsync("tar", ["--exclude", "./logs", "-C", root, "-cf", archivePath, "."]);
  return { archiveDir, archivePath };
}

async function workspaceFixture() {
  const root = await mkdtemp(path.join(tmpdir(), "daoflow-boxlite-workspace-"));
  const workspace = {
    codexHomePath: path.join(root, "home/.codex"),
    configPath: path.join(root, "home/.codex/config.toml"),
    authJsonPath: path.join(root, "home/.codex/auth.json"),
    repoPath: path.join(root, "repo"),
    artifactsPath: path.join(root, "artifacts"),
    logsPath: path.join(root, "logs"),
    promptPath: path.join(root, "artifacts/task-prompt.md"),
    runPlanPath: path.join(root, "artifacts/codex-run-plan.json")
  } satisfies PreparedDevelopmentTaskCodexWorkspace;
  await Promise.all([
    mkdir(workspace.repoPath, { recursive: true }),
    mkdir(workspace.codexHomePath, { recursive: true }),
    mkdir(workspace.artifactsPath, { recursive: true }),
    mkdir(workspace.logsPath, { recursive: true })
  ]);
  await Promise.all([
    writeFile(path.join(workspace.repoPath, "delete-me.txt"), "old"),
    writeFile(path.join(workspace.logsPath, "codex-exec.jsonl"), "local log")
  ]);

  return { root, workspace };
}

function fakeProvider(input: {
  boxRoot: string;
  workspace: PreparedDevelopmentTaskCodexWorkspace;
  exitCode?: number;
}) {
  const destroyCalls: string[] = [];
  const sandbox = {
    id: "box_1",
    state: "running",
    createdAt: new Date(0).toISOString(),
    async exec(command, options) {
      if (command.startsWith("mkdir -p ")) {
        expect(options).toMatchObject({ asRoot: true });
        expect(command).toContain("chown -R 'daoflow'");
        expect(command).not.toContain("daoflow:daoflow");
        return { exitCode: 0, stdout: "", stderr: "" };
      }
      expect(options?.cwd).toBe(input.workspace.repoPath);
      if (input.exitCode) {
        return { exitCode: input.exitCode, stdout: "", stderr: "failed" };
      }
      await rm(path.join(input.boxRoot, "repo/delete-me.txt"), { force: true });
      await writeFile(path.join(input.boxRoot, "repo/created.txt"), "new");
      await mkdir(path.join(input.boxRoot, "logs"), { recursive: true });
      await writeFile(path.join(input.boxRoot, "logs/codex-exec.jsonl"), "remote log");
      return { exitCode: 0, stdout: "ok", stderr: "" };
    },
    async writeFile(filePath, content) {
      await writeFile(path.join(input.boxRoot, filePath), content);
    },
    async readFile(filePath) {
      return readFile(path.join(input.boxRoot, filePath));
    },
    async uploadArchive(archive) {
      const archivePath = path.join(input.boxRoot, "upload.tar");
      await writeFile(archivePath, Buffer.from(archive as Uint8Array));
      await execFileAsync("tar", ["-C", input.boxRoot, "-xf", archivePath]);
    },
    async downloadArchive() {
      const { archivePath } = await tarDirectory(input.boxRoot);
      return Readable.toWeb(createReadStream(archivePath)) as ReadableStream;
    }
  } satisfies Sandbox;

  const provider = {
    name: "boxlite",
    capabilities: new Set(),
    create() {
      return Promise.resolve(sandbox);
    },
    get() {
      return Promise.resolve(sandbox);
    },
    list() {
      return Promise.resolve([]);
    },
    destroy(id) {
      destroyCalls.push(id);
      return Promise.resolve();
    }
  } satisfies SandboxProvider;

  return { provider, destroyCalls };
}

describe("development task Sandbank BoxLite sandbox", () => {
  it("defaults to local BoxLite on the selected host runner", () => {
    const sandbox = buildSandbankBoxLiteSandboxFromRun({
      runId: "run_boxlite",
      metadata: {}
    });

    expect(sandbox).toMatchObject({
      provider: "sandbank_boxlite",
      sandboxName: "daoflow-boxlite-devtask-run_boxlite",
      image: "ubuntu:24.04",
      cpuLimit: 2,
      memoryLimitMb: 4096,
      diskSizeGb: 20,
      timeoutMinutes: 60,
      retainOnFailure: false,
      mode: "local",
      apiTokenEnvKey: "BOXLITE_API_TOKEN",
      clientIdEnvKey: "BOXLITE_CLIENT_ID",
      clientSecretEnvKey: "BOXLITE_CLIENT_SECRET"
    });
  });

  it("uses remote BoxRun settings from runner metadata", () => {
    const sandbox = buildSandbankBoxLiteSandboxFromRun({
      runId: "run_remote",
      metadata: {
        boxLiteApiUrl: "http://boxrun.internal:9090",
        boxLitePrefix: "daoflow",
        boxLiteApiTokenEnvKey: "TEAM_BOXLITE_TOKEN",
        image: "ghcr.io/daoflow-dev/codex-runner:test",
        cpuLimit: 4,
        memoryLimitMb: 8192,
        diskSizeGb: 40,
        timeoutMinutes: 90,
        retainOnFailure: true
      }
    });

    expect(sandbox).toMatchObject({
      provider: "sandbank_boxlite",
      sandboxName: "daoflow-boxlite-devtask-run_remote",
      image: "ghcr.io/daoflow-dev/codex-runner:test",
      cpuLimit: 4,
      memoryLimitMb: 8192,
      diskSizeGb: 40,
      timeoutMinutes: 90,
      retainOnFailure: true,
      mode: "remote",
      apiUrl: "http://boxrun.internal:9090",
      prefix: "daoflow",
      apiTokenEnvKey: "TEAM_BOXLITE_TOKEN"
    });
  });

  it("syncs repository changes back without replacing local execution logs", async () => {
    const { root, workspace } = await workspaceFixture();
    const boxRoot = await mkdtemp(path.join(tmpdir(), "daoflow-boxlite-remote-"));
    const { provider, destroyCalls } = fakeProvider({ boxRoot, workspace });

    const result = await runSandbankBoxLiteCommand({
      workspace,
      sandbox: buildSandbankBoxLiteSandboxFromRun({ runId: "run_sync", metadata: {} }),
      command: "codex",
      args: ["exec", "do work"],
      onLog: () => undefined,
      provider
    });

    expect(result.exitCode).toBe(0);
    await expect(
      readFile(path.join(workspace.repoPath, "delete-me.txt"), "utf8")
    ).rejects.toThrow();
    await expect(readFile(path.join(workspace.repoPath, "created.txt"), "utf8")).resolves.toBe(
      "new"
    );
    await expect(readFile(path.join(workspace.logsPath, "codex-exec.jsonl"), "utf8")).resolves.toBe(
      "local log"
    );
    expect(destroyCalls).toEqual(["box_1"]);

    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(boxRoot, { recursive: true, force: true })
    ]);
  });

  it("does not return raw command arguments when execution fails", async () => {
    const { root, workspace } = await workspaceFixture();
    const boxRoot = await mkdtemp(path.join(tmpdir(), "daoflow-boxlite-remote-"));
    const { provider } = fakeProvider({ boxRoot, workspace, exitCode: 2 });

    const result = await runSandbankBoxLiteCommand({
      workspace,
      sandbox: buildSandbankBoxLiteSandboxFromRun({ runId: "run_failed", metadata: {} }),
      command: "codex",
      args: ["exec", "--api-key", "secret-token"],
      onLog: () => undefined,
      provider
    });

    expect(result).toMatchObject({
      exitCode: 2,
      failedCommand: "sandbox command 1"
    });
    expect(result.failedCommand).not.toContain("secret-token");

    await Promise.all([
      rm(root, { recursive: true, force: true }),
      rm(boxRoot, { recursive: true, force: true })
    ]);
  });
});
