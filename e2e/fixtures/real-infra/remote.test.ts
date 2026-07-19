import { describe, expect, test } from "bun:test";
import type { RealInfraConfig } from "./config";
import type { RealInfraNames } from "./names";
import { assertZeroOwnedRemote } from "./remote";
import type { PinnedSshSession } from "./ssh";

describe("real-infrastructure remote cleanup evidence", () => {
  test("reports the exact token-owned resources that remain", async () => {
    const calls: unknown[][] = [];
    const run = async (...args: unknown[]) => {
      calls.push(args);
      return "container:abc123\nvolume:daoflow-ri-volume-token\nworkspace:/tmp/owned\n";
    };
    const session = { run } as unknown as PinnedSshSession;
    const config = { workspaceRoot: "/tmp/owned" } as RealInfraConfig;
    const names = {
      composeProject: "daoflow-ri-token",
      volume: "daoflow-ri-volume-token"
    } as RealInfraNames;

    await expect(assertZeroOwnedRemote(session, config, names)).rejects.toThrow(
      "container:abc123\nvolume:daoflow-ri-volume-token\nworkspace:/tmp/owned"
    );
    expect(calls).toEqual([[expect.stringContaining("container:%s"), 90_000, true]]);
  });
});
