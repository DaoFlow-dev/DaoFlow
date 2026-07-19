import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock
}));
vi.mock("./remote-volume-transfer", () => ({ restoreRemoteVolumeArchive: vi.fn() }));

import { prepareRemoteVolumeArchive, restoreVolumeRemoteTestHooks } from "./restore-volume-remote";
import type { RestoreExecutionContext } from "./restore-execution";

afterEach(() => vi.clearAllMocks());

function restoreContext(overrides: Partial<RestoreExecutionContext> = {}): RestoreExecutionContext {
  return {
    restoreId: "brest_test",
    runId: "brun_test",
    artifactPath: "postgres-policy/2026-07-18",
    destinationId: "dest_test",
    volumeId: "vol_test",
    destination: { id: "dest_test", provider: "local", localPath: "/tmp/daoflow-backups" },
    mode: "restore",
    targetPath: "/tmp/daoflow-restore-target",
    downloadPath: "/tmp/daoflow-restore-download",
    encryptionMode: "none",
    backupType: "volume",
    volumeName: "postgres-volume",
    sourceKind: "docker-volume",
    serverId: "srv_remote",
    teamId: "team_test",
    serverHost: "203.0.113.20",
    mountPath: "/srv/app-data",
    ...overrides
  };
}

function createChild(): {
  child: ChildProcess;
  kill: ReturnType<typeof vi.fn>;
  stderr: PassThrough;
} {
  const child = new EventEmitter() as ChildProcess;
  const stderr = new PassThrough();
  const kill = vi.fn(() => {
    queueMicrotask(() => child.emit("close", null, "SIGTERM"));
    return true;
  });
  Object.assign(child, { stderr, kill });
  return { child, kill, stderr };
}

describe("prepareRemoteVolumeArchive", () => {
  it("uses an async archive command and propagates cancellation", async () => {
    const root = mkdtempSync(join(tmpdir(), "daoflow-remote-archive-prep-"));
    const source = join(root, "download");
    mkdirSync(source);
    writeFileSync(join(source, "volume-data.txt"), "backup payload");
    const { child, kill } = createChild();
    spawnMock.mockReturnValue(child);
    const controller = new AbortController();
    const cancellation = new Error("cancel local restore archive preparation");

    try {
      const operation = prepareRemoteVolumeArchive(restoreContext(), source, controller.signal);
      await vi.waitFor(() =>
        expect(spawnMock).toHaveBeenCalledWith("tar", expect.any(Array), expect.any(Object))
      );
      const firstCall: unknown = spawnMock.mock.calls[0];
      if (!Array.isArray(firstCall)) throw new Error("Expected archive command call.");
      const commandArgs: unknown = firstCall[1];
      if (!Array.isArray(commandArgs)) throw new Error("Expected archive command arguments.");
      const archivePath: unknown = commandArgs[3];
      if (typeof archivePath !== "string") throw new Error("Expected generated archive path.");
      writeFileSync(archivePath, "partial archive");
      controller.abort(cancellation);

      await expect(operation).rejects.toBe(cancellation);
      expect(kill).toHaveBeenCalledWith("SIGTERM");
      expect(existsSync(archivePath)).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("redacts archive passwords from async decryption failures", async () => {
    const root = mkdtempSync(join(tmpdir(), "daoflow-remote-archive-redaction-"));
    const source = join(root, "download");
    const password = "restore-password-never-in-errors";
    mkdirSync(source);
    writeFileSync(join(source, "volume.7z"), "encrypted payload");
    const { child, stderr } = createChild();
    spawnMock.mockImplementation(() => {
      queueMicrotask(() => {
        stderr.write(`archive rejected ${password}`);
        child.emit("close", 2, null);
      });
      return child;
    });

    try {
      const result = await prepareRemoteVolumeArchive(
        restoreContext({
          encryptionMode: "archive-7z",
          destination: {
            id: "dest_test",
            provider: "local",
            localPath: "/tmp/daoflow-backups",
            encryptionPassword: password
          }
        }),
        source
      );

      expect(result).toMatchObject({ success: false });
      expect(JSON.stringify(result)).toContain("[redacted]");
      expect(JSON.stringify(result)).not.toContain(password);
      expect(existsSync(join(source, "remote-volume-decrypted"))).toBe(false);
    } finally {
      rmSync(root, { recursive: true, force: true });
    }
  });

  it("preserves a frozen cancellation reason when plaintext cleanup also fails", () => {
    const originalCause = new Error("workflow cancellation cause");
    const cancellation = Object.freeze(new Error("restore cancellation", { cause: originalCause }));
    const controller = new AbortController();
    controller.abort(cancellation);

    const result = restoreVolumeRemoteTestHooks.cancellationWithCleanup(controller.signal, [
      "Could not remove plaintext restore staging"
    ]);

    expect(result).not.toBe(cancellation);
    expect(result.message).toContain("restore cancellation Cleanup also failed");
    expect(cancellation.message).toBe("restore cancellation");
    expect(cancellation.cause).toBe(originalCause);
    expect(result.cause).toBeInstanceOf(AggregateError);
    expect((result.cause as AggregateError).errors).toContain(cancellation);
  });
});
