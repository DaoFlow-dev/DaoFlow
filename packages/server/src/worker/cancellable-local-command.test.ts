import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:child_process")>()),
  spawn: spawnMock
}));

import { runCancellableLocalCommand } from "./cancellable-local-command";

afterEach(() => spawnMock.mockReset());

describe("cancellable local command", () => {
  it("stops a stdin-streaming command and preserves the cancellation reason", async () => {
    const directory = mkdtempSync(join(tmpdir(), "daoflow-command-input-"));
    const inputPath = join(directory, "dump.bin");
    writeFileSync(inputPath, "database dump");
    const child = new EventEmitter() as ChildProcess;
    const kill = vi.fn(() => {
      queueMicrotask(() => child.emit("close", null, "SIGTERM"));
      return true;
    });
    Object.assign(child, {
      stdin: new PassThrough(),
      stderr: new PassThrough(),
      kill
    });
    spawnMock.mockReturnValue(child);
    const controller = new AbortController();
    const cancellation = new Error("cancel streaming restore");

    try {
      const operation = runCancellableLocalCommand("docker", ["exec", "-i", "postgres"], {
        description: "Database restore failed",
        timeoutMs: 60_000,
        signal: controller.signal,
        stdinFilePath: inputPath
      });
      controller.abort(cancellation);

      await expect(operation).rejects.toBe(cancellation);
      expect(kill).toHaveBeenCalledWith("SIGTERM");
    } finally {
      rmSync(directory, { recursive: true, force: true });
    }
  });
});
