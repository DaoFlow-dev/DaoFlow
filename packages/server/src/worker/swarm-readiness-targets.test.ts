import { describe, expect, it, vi } from "vitest";
import type { ComposeReadinessProbeSnapshot } from "../compose-readiness";
import type { LogLine } from "./docker-executor";
import { resolveSwarmInternalNetworkTargets } from "./swarm-readiness-targets";

const probe: ComposeReadinessProbeSnapshot = {
  serviceName: "api",
  type: "tcp",
  target: "internal-network",
  port: 8080,
  timeoutSeconds: 60,
  intervalSeconds: 3
};

function onLog(_line: LogLine) {
  return;
}

describe("resolveSwarmInternalNetworkTargets", () => {
  it("resolves matching running local Swarm task addresses", async () => {
    const inspectLocalTaskAddresses = vi
      .fn()
      .mockResolvedValueOnce({ exitCode: 0, addresses: ["10.0.0.12", "10.0.0.13"] });

    await expect(
      resolveSwarmInternalNetworkTargets(
        {
          stackName: "demo-stack",
          workDir: "/tmp/demo-stack",
          probe,
          tasks: [
            {
              id: "task_api_1",
              name: "demo-stack_api.1",
              image: "ghcr.io/example/api:stable",
              node: "manager-1",
              desiredState: "Running",
              currentState: "Running 3 seconds ago",
              error: null,
              ports: null
            },
            {
              id: "task_api_2",
              name: "demo-stack_api.2",
              image: "ghcr.io/example/api:stable",
              node: "worker-1",
              desiredState: "Running",
              currentState: "Pending 1 second ago",
              error: null,
              ports: null
            },
            {
              id: "task_web_1",
              name: "demo-stack_web.1",
              image: "ghcr.io/example/web:stable",
              node: "manager-1",
              desiredState: "Running",
              currentState: "Running 3 seconds ago",
              error: null,
              ports: null
            }
          ],
          onLog,
          target: { mode: "local", serverKind: "docker-swarm-manager" }
        },
        { inspectLocalTaskAddresses }
      )
    ).resolves.toEqual([
      { label: "demo-stack_api.1", address: "10.0.0.12" },
      { label: "demo-stack_api.1", address: "10.0.0.13" }
    ]);

    expect(inspectLocalTaskAddresses).toHaveBeenCalledTimes(1);
    expect(inspectLocalTaskAddresses).toHaveBeenCalledWith("task_api_1", "/tmp/demo-stack", onLog);
  });

  it("resolves matching remote Swarm task addresses and de-duplicates entries", async () => {
    const inspectRemoteTaskAddresses = vi.fn().mockResolvedValueOnce({
      exitCode: 0,
      addresses: ["10.0.1.20", "10.0.1.20", "10.0.1.21"]
    });

    await expect(
      resolveSwarmInternalNetworkTargets(
        {
          stackName: "demo-stack",
          workDir: "/srv/demo-stack",
          probe,
          tasks: [
            {
              id: "task_api_1",
              name: "demo-stack_api.1",
              image: "ghcr.io/example/api:stable",
              node: "worker-1",
              desiredState: "Running",
              currentState: "Running 2 seconds ago",
              error: null,
              ports: null
            }
          ],
          onLog,
          target: {
            mode: "remote",
            remoteWorkDir: "/srv/demo-stack",
            serverKind: "docker-swarm-manager",
            ssh: {
              serverName: "prod",
              host: "example.com",
              port: 22
            }
          }
        },
        { inspectRemoteTaskAddresses }
      )
    ).resolves.toEqual([
      { label: "demo-stack_api.1", address: "10.0.1.20" },
      { label: "demo-stack_api.1", address: "10.0.1.21" }
    ]);

    expect(inspectRemoteTaskAddresses).toHaveBeenCalledWith(
      {
        serverName: "prod",
        host: "example.com",
        port: 22
      },
      "task_api_1",
      "/srv/demo-stack",
      onLog
    );
  });
});
