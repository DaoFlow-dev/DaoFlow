import { describe, expect, it } from "vitest";
import {
  hasSandboxCapability,
  readSandboxCapabilities,
  resolveSandboxRunnerCapabilities
} from "./development-task-runner-capabilities";

describe("development task runner capabilities", () => {
  it("resolves host Docker and BoxLite default capabilities", () => {
    expect(resolveSandboxRunnerCapabilities({ provider: "host_docker", metadata: {} })).toEqual([
      "exec",
      "exec.stream",
      "files.read",
      "files.write",
      "archive.upload",
      "archive.download"
    ]);
    expect(
      resolveSandboxRunnerCapabilities({ provider: "sandbank_boxlite", metadata: {} })
    ).toEqual(
      expect.arrayContaining([
        "exec",
        "exec.stream",
        "snapshot",
        "port.expose",
        "terminal",
        "sleep"
      ])
    );
  });

  it("filters configured capabilities to the supported vocabulary", () => {
    const metadata = {
      capabilities: ["exec", "sleep", "unknown"]
    };

    expect(readSandboxCapabilities(metadata)).toEqual(["exec", "sleep"]);
    expect(hasSandboxCapability(metadata, "exec")).toBe(true);
    expect(hasSandboxCapability(metadata, "terminal")).toBe(false);
  });
});
