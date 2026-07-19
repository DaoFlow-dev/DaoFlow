import type { ChildProcess } from "node:child_process";
import { EventEmitter } from "node:events";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { RealInfraConfig } from "./config";

const { spawnMock } = vi.hoisted(() => ({ spawnMock: vi.fn() }));

vi.mock("node:child_process", () => ({ spawn: spawnMock }));

import { PinnedSshSession } from "./ssh";

const config = {
  ssh: {
    host: "example.test",
    port: 22,
    user: "debian",
    privateKey: "test-private-key",
    markerPath: "/srv/daoflow-real-infra.marker",
    markerNonce: "nonce-for-ssh-timeout-test"
  }
} as RealInfraConfig;

afterEach(() => {
  vi.clearAllMocks();
  vi.useRealTimers();
});

describe("pinned SSH preflight", () => {
  it("uses bounded TERM then KILL handling and clears KILL after process exit", async () => {
    vi.useFakeTimers();
    const child = new EventEmitter() as ChildProcess;
    const kill = vi.fn();
    Object.assign(child, { kill });
    spawnMock.mockReturnValue(child);
    const session = new PinnedSshSession(config);

    try {
      await session.start();
      const command = session.run("true", 1);
      const timedOut = expect(command).rejects.toThrow("Pinned SSH command timed out after 1ms");

      await vi.advanceTimersByTimeAsync(1);
      await timedOut;
      expect(kill).toHaveBeenCalledWith("SIGTERM");

      child.emit("close", null, "SIGTERM");
      await vi.advanceTimersByTimeAsync(5_000);
      expect(kill).not.toHaveBeenCalledWith("SIGKILL");
    } finally {
      await session.stop();
    }
  });
});
