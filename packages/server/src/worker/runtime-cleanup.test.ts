import { describe, expect, it, vi } from "vitest";
import type { ExecutionTarget } from "./execution-target";
import {
  cleanupComposeProjectRuntime,
  cleanupContainerRuntime,
  cleanupSwarmStackRuntime,
  type DockerCommandResult
} from "./runtime-cleanup";

const target: ExecutionTarget = {
  mode: "remote",
  serverKind: "docker-engine",
  ssh: {
    serverName: "prod",
    host: "example.com",
    port: 22
  },
  remoteWorkDir: "/tmp/daoflow-cleanup"
};

function onLog() {
  return;
}

describe("cleanupComposeProjectRuntime", () => {
  it("removes compose containers, networks, and volumes by compose project label", async () => {
    const execute = vi
      .fn<(_: ExecutionTarget, args: string[]) => Promise<DockerCommandResult>>()
      .mockResolvedValueOnce({ exitCode: 0, stdout: ["container-1", "container-2"], stderr: [] })
      .mockResolvedValueOnce({ exitCode: 0, stdout: [], stderr: [] })
      .mockResolvedValueOnce({ exitCode: 0, stdout: ["network-1"], stderr: [] })
      .mockResolvedValueOnce({ exitCode: 0, stdout: [], stderr: [] })
      .mockResolvedValueOnce({ exitCode: 0, stdout: ["volume-1"], stderr: [] })
      .mockResolvedValueOnce({ exitCode: 0, stdout: [], stderr: [] });

    const result = await cleanupComposeProjectRuntime(target, "demo", onLog, execute);

    expect(result).toEqual({
      removedContainers: 2,
      removedNetworks: 1,
      removedVolumes: 1
    });
    expect(execute.mock.calls.map((call) => call[1])).toEqual([
      ["ps", "-aq", "--filter", "label=com.docker.compose.project=demo"],
      ["rm", "-f", "container-1", "container-2"],
      ["network", "ls", "-q", "--filter", "label=com.docker.compose.project=demo"],
      ["network", "rm", "network-1"],
      ["volume", "ls", "-q", "--filter", "label=com.docker.compose.project=demo"],
      ["volume", "rm", "volume-1"]
    ]);
  });
});

describe("cleanupContainerRuntime", () => {
  it("ignores already-absent containers", async () => {
    const execute = vi.fn().mockResolvedValueOnce({
      exitCode: 1,
      stdout: [],
      stderr: ["Error response from daemon: No such container: demo-api"]
    });

    await expect(
      cleanupContainerRuntime(target, "demo-api", onLog, execute)
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledWith(target, ["rm", "-f", "demo-api"], onLog);
  });
});

describe("cleanupSwarmStackRuntime", () => {
  it("removes the target stack by name", async () => {
    const execute = vi.fn().mockResolvedValueOnce({ exitCode: 0, stdout: [], stderr: [] });

    await cleanupSwarmStackRuntime(target, "demo", onLog, execute);

    expect(execute).toHaveBeenCalledWith(target, ["stack", "rm", "demo"], onLog);
  });
});
