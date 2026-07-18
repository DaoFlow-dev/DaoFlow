import type { ChildProcessWithoutNullStreams } from "node:child_process";
import { EventEmitter } from "node:events";
import { PassThrough } from "node:stream";
import { afterEach, describe, expect, it, vi } from "vitest";

const { createReadStreamMock, spawnMock } = vi.hoisted(() => ({
  createReadStreamMock: vi.fn(),
  spawnMock: vi.fn()
}));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));
vi.mock("node:fs", async (importOriginal) => ({
  ...(await importOriginal<typeof import("node:fs")>()),
  createReadStream: createReadStreamMock
}));

import { postgresRestoreVerificationCommandTestHooks } from "./postgres-restore-verification-commands";

function createChild(): {
  child: ChildProcessWithoutNullStreams;
  kill: ReturnType<typeof vi.fn>;
} {
  const child = new EventEmitter() as ChildProcessWithoutNullStreams;
  const kill = vi.fn();
  Object.assign(child, {
    stdin: new PassThrough(),
    stdout: new PassThrough(),
    stderr: new PassThrough(),
    kill
  });
  return { child, kill };
}

afterEach(() => {
  vi.clearAllMocks();
});

describe("PostgreSQL verifier Docker command streaming", () => {
  it("handles EPIPE from Docker stdin, stops the input stream, and rejects once", async () => {
    const { child, kill } = createChild();
    const input = new PassThrough();
    spawnMock.mockReturnValue(child);
    createReadStreamMock.mockReturnValue(input);

    let rejections = 0;
    const result = postgresRestoreVerificationCommandTestHooks
      .runDockerCommand({
        args: ["exec", "verifier", "pg_restore"],
        timeoutMs: 1_000,
        stdinPath: "/dump"
      })
      .catch((error: unknown) => {
        rejections += 1;
        return error;
      });
    const epipe = Object.assign(new Error("write EPIPE"), { code: "EPIPE" });

    child.stdin.emit("error", epipe);
    child.emit("close", 1);

    await expect(result).resolves.toBe(epipe);
    expect(rejections).toBe(1);
    expect(input.destroyed).toBe(true);
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });

  it("stops the input stream when reading the dump fails", async () => {
    const { child, kill } = createChild();
    const input = new PassThrough();
    spawnMock.mockReturnValue(child);
    createReadStreamMock.mockReturnValue(input);

    const result = postgresRestoreVerificationCommandTestHooks.runDockerCommand({
      args: ["exec", "verifier", "pg_restore"],
      timeoutMs: 1_000,
      stdinPath: "/dump"
    });
    const readError = new Error("dump read failed");

    input.emit("error", readError);

    await expect(result).rejects.toBe(readError);
    expect(input.destroyed).toBe(true);
    expect(kill).toHaveBeenCalledWith("SIGTERM");
  });
});
