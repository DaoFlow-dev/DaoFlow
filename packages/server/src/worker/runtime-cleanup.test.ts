import { describe, expect, it, vi } from "vitest";
import {
  buildDockerOwnershipLabels,
  DOCKER_OWNERSHIP_LABEL_KEYS,
  type DockerOwnershipIdentity
} from "../docker-ownership";
import type { ExecutionTarget } from "./execution-target";
import {
  cleanupComposeProjectRuntime,
  cleanupContainerRuntime,
  cleanupSwarmStackRuntime,
  type DockerCommandResult,
  type DockerTargetExecutor
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

const swarmTarget: ExecutionTarget = {
  ...target,
  serverKind: "docker-swarm-manager"
};

const ownership: DockerOwnershipIdentity = {
  teamId: "team_test",
  projectId: "project_test",
  environmentId: "environment_test",
  serviceId: "service_test",
  deploymentId: "deployment_current"
};

const previousOwnership: DockerOwnershipIdentity = {
  ...ownership,
  deploymentId: "deployment_previous"
};

function onLog() {
  return;
}

function result(stdout: string[] = [], exitCode = 0): DockerCommandResult {
  return { exitCode, stdout, stderr: [] };
}

function inspectLine(id: string, labels: Record<string, string>): string {
  return [
    JSON.stringify(id),
    ...DOCKER_OWNERSHIP_LABEL_KEYS.map((key) => JSON.stringify(labels[key] ?? null))
  ].join("\t");
}

describe("cleanupComposeProjectRuntime", () => {
  it("removes only resources with matching DaoFlow ownership", async () => {
    const labels = buildDockerOwnershipLabels(previousOwnership);
    const execute = vi
      .fn<DockerTargetExecutor>()
      .mockResolvedValueOnce(result(["container-1", "container-2"]))
      .mockResolvedValueOnce(
        result([inspectLine("container-1", labels), inspectLine("container-2", labels)])
      )
      .mockResolvedValueOnce(result(["network-1"]))
      .mockResolvedValueOnce(result([inspectLine("network-1", labels)]))
      .mockResolvedValueOnce(result(["volume-1"]))
      .mockResolvedValueOnce(result([inspectLine("volume-1", labels)]))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result());

    const resultValue = await cleanupComposeProjectRuntime(
      target,
      "demo",
      [ownership],
      onLog,
      execute
    );

    expect(resultValue).toEqual({
      removedContainers: 2,
      removedNetworks: 1,
      removedVolumes: 0
    });
    expect(execute.mock.calls.map((call) => call[1])).toEqual([
      ["ps", "-aq", "--filter", "label=com.docker.compose.project=demo"],
      expect.arrayContaining(["inspect", "--type", "container", "container-1", "container-2"]),
      ["network", "ls", "-q", "--filter", "label=com.docker.compose.project=demo"],
      expect.arrayContaining(["network", "inspect", "network-1"]),
      ["volume", "ls", "-q", "--filter", "label=com.docker.compose.project=demo"],
      expect.arrayContaining(["volume", "inspect", "volume-1"]),
      ["rm", "-f", "container-1", "container-2"],
      ["network", "rm", "network-1"]
    ]);
  });

  it("leaves an unowned Compose collision untouched", async () => {
    const execute = vi
      .fn<DockerTargetExecutor>()
      .mockResolvedValueOnce(result(["external-api"]))
      .mockResolvedValueOnce(result([inspectLine("external-api", {})]));

    await expect(
      cleanupComposeProjectRuntime(target, "demo", [ownership], onLog, execute)
    ).rejects.toThrow('Compose project "demo" has an unowned container (external-api)');

    expect(execute.mock.calls.map((call) => call[1])).toEqual([
      ["ps", "-aq", "--filter", "label=com.docker.compose.project=demo"],
      expect.arrayContaining(["inspect", "--type", "container", "external-api"])
    ]);
    expect(execute.mock.calls.some((call) => call[1]?.[0] === "rm")).toBe(false);
  });
});

describe("cleanupContainerRuntime", () => {
  it("ignores already-absent containers", async () => {
    const execute = vi.fn<DockerTargetExecutor>().mockResolvedValueOnce({
      exitCode: 1,
      stdout: [],
      stderr: ["Error response from daemon: No such container: demo-api"]
    });

    await expect(
      cleanupContainerRuntime(target, "demo-api", [ownership], onLog, execute)
    ).resolves.toBeUndefined();
    expect(execute).toHaveBeenCalledTimes(1);
  });

  it("removes a matching container by its verified ID", async () => {
    const labels = buildDockerOwnershipLabels(previousOwnership);
    const execute = vi
      .fn<DockerTargetExecutor>()
      .mockResolvedValueOnce(result([inspectLine("container-verified", labels)]))
      .mockResolvedValueOnce(result());

    await cleanupContainerRuntime(target, "demo-api", [ownership], onLog, execute);

    expect(execute.mock.calls.map((call) => call[1])).toEqual([
      expect.arrayContaining(["inspect", "--type", "container", "demo-api"]),
      ["rm", "-f", "container-verified"]
    ]);
  });

  it("leaves an unowned container collision untouched", async () => {
    const execute = vi
      .fn<DockerTargetExecutor>()
      .mockResolvedValueOnce(result([inspectLine("container-external", {})]));

    await expect(
      cleanupContainerRuntime(target, "demo-api", [ownership], onLog, execute)
    ).rejects.toThrow('Container "demo-api" has an unowned runtime (container-external)');
    expect(execute).toHaveBeenCalledTimes(1);
  });
});

describe("cleanupSwarmStackRuntime", () => {
  it("removes only verified Swarm resources by ID", async () => {
    const labels = buildDockerOwnershipLabels(previousOwnership);
    const execute = vi
      .fn<DockerTargetExecutor>()
      .mockResolvedValueOnce(result(["service-1"]))
      .mockResolvedValueOnce(result([inspectLine("service-1", labels)]))
      .mockResolvedValueOnce(result(["network-1"]))
      .mockResolvedValueOnce(result([inspectLine("network-1", labels)]))
      .mockResolvedValueOnce(result(["config-1"]))
      .mockResolvedValueOnce(result([inspectLine("config-1", labels)]))
      .mockResolvedValueOnce(result(["secret-1"]))
      .mockResolvedValueOnce(result([inspectLine("secret-1", labels)]))
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result())
      .mockResolvedValueOnce(result());

    await cleanupSwarmStackRuntime(swarmTarget, "demo", [ownership], onLog, execute);

    expect(execute.mock.calls.map((call) => call[1])).toEqual([
      ["service", "ls", "-q", "--filter", "label=com.docker.stack.namespace=demo"],
      expect.arrayContaining(["service", "inspect", "service-1"]),
      ["network", "ls", "-q", "--filter", "label=com.docker.stack.namespace=demo"],
      expect.arrayContaining(["network", "inspect", "network-1"]),
      ["config", "ls", "-q", "--filter", "label=com.docker.stack.namespace=demo"],
      expect.arrayContaining(["config", "inspect", "config-1"]),
      ["secret", "ls", "-q", "--filter", "label=com.docker.stack.namespace=demo"],
      expect.arrayContaining(["secret", "inspect", "secret-1"]),
      ["service", "rm", "service-1"],
      ["network", "rm", "network-1"],
      ["config", "rm", "config-1"],
      ["secret", "rm", "secret-1"]
    ]);
  });
});
