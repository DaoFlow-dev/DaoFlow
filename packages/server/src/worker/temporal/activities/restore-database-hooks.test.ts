import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  collectDockerJsonLines: vi.fn(),
  runCancellableLocalCommand: vi.fn(),
  spawn: vi.fn(),
  sshArgs: vi.fn((target: { host: string }) => ["--target", target.host])
}));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: mocks.spawn
}));

vi.mock("../../server-host-command", () => ({
  collectDockerJsonLines: mocks.collectDockerJsonLines
}));

vi.mock("../../cancellable-local-command", () => ({
  runCancellableLocalCommand: mocks.runCancellableLocalCommand
}));

vi.mock("../../ssh-connection", () => ({
  shellQuote: (value: string) => value,
  sshArgs: mocks.sshArgs
}));

import { restoreDatabaseTestHooks } from "./restore-database";

const roots: string[] = [];

afterEach(() => {
  vi.useRealTimers();
  while (roots.length > 0) rmSync(roots.pop() as string, { recursive: true, force: true });
  mocks.collectDockerJsonLines.mockReset();
  mocks.runCancellableLocalCommand.mockReset();
  mocks.spawn.mockReset();
  mocks.sshArgs.mockClear();
});

function dumpFile() {
  const root = mkdtempSync(join(tmpdir(), "daoflow-restore-hook-"));
  roots.push(root);
  const path = join(root, "dump.custom");
  writeFileSync(path, "dump");
  return path;
}

function child() {
  const process = new EventEmitter() as EventEmitter & {
    stdin: PassThrough;
    stdout: PassThrough;
    stderr: PassThrough;
    kill: ReturnType<typeof vi.fn>;
  };
  process.stdin = new PassThrough();
  process.stdout = new PassThrough();
  process.stderr = new PassThrough();
  process.kill = vi.fn();
  return process;
}

describe("external database restore process hooks", () => {
  it("heartbeats during a long restore before the Temporal heartbeat deadline", async () => {
    vi.useFakeTimers();
    let completeRestore: (() => void) | undefined;
    mocks.runCancellableLocalCommand.mockImplementation(
      () =>
        new Promise<void>((resolve) => {
          completeRestore = resolve;
        })
    );
    let heartbeats = 0;
    const pending = restoreDatabaseTestHooks.runDockerDatabaseRestore(
      { mode: "local" },
      "postgres-container",
      { envArgs: [], args: ["pg_restore"] },
      dumpFile(),
      { heartbeat: () => heartbeats++, timeoutMs: 60_000 }
    );
    await vi.advanceTimersByTimeAsync(15_000);
    completeRestore?.();
    await expect(pending).resolves.toBeUndefined();
    expect(heartbeats).toBeGreaterThanOrEqual(2);
  });

  it("cancels the docker process and rejects instead of allowing a duplicate retry", async () => {
    const process = child();
    mocks.spawn.mockReturnValue(process);
    const controller = new AbortController();
    const pending = restoreDatabaseTestHooks.runDockerDatabaseRestore(
      {
        mode: "remote",
        serverKind: "docker-engine",
        remoteWorkDir: "/tmp/restore",
        ssh: { serverName: "production", host: "203.0.113.8", port: 22 }
      },
      "postgres-container",
      { envArgs: [], args: ["pg_restore"] },
      dumpFile(),
      { cancellationSignal: controller.signal }
    );
    controller.abort();
    await expect(pending).rejects.toThrow("cancelled");
    expect(process.kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("resolves the concrete local Compose container before restoring", async () => {
    mocks.collectDockerJsonLines.mockResolvedValue({
      exitCode: 0,
      stdout: ["project-postgres-1"],
      stderr: []
    });

    await expect(
      restoreDatabaseTestHooks.resolveDatabaseContainer({
        databaseEngine: "postgres",
        volumeName: "postgres-data",
        executionTarget: { mode: "local" },
        runtime: {
          kind: "compose",
          projectName: "project",
          serviceName: "postgres"
        }
      })
    ).resolves.toBe("project-postgres-1");

    expect(mocks.collectDockerJsonLines).toHaveBeenCalledWith(
      { mode: "local" },
      expect.arrayContaining([
        "label=com.docker.compose.project=project",
        "label=com.docker.compose.service=postgres"
      ])
    );
  });

  it("streams pg_restore through SSH when the approved target is remote", () => {
    const process = child();
    mocks.spawn.mockReturnValue(process);
    const target = {
      mode: "remote" as const,
      serverKind: "docker-engine",
      remoteWorkDir: "/tmp/restore",
      ssh: { serverName: "production", host: "203.0.113.8", port: 22 }
    };

    restoreDatabaseTestHooks.spawnTargetDockerCommand(target, [
      "exec",
      "-i",
      "project-postgres-1",
      "pg_restore"
    ]);

    expect(mocks.spawn).toHaveBeenCalledWith(
      expect.any(String),
      ["--target", "203.0.113.8", expect.stringContaining("exec -i project-postgres-1 pg_restore")],
      expect.objectContaining({ stdio: ["pipe", "pipe", "pipe"] })
    );
  });
});
