import { describe, expect, it, vi } from "vitest";
import {
  buildDockerOwnershipLabels,
  DOCKER_OWNERSHIP_LABEL_KEYS,
  type DockerOwnershipIdentity
} from "../docker-ownership";
import { assertComposeRuntimeOwnership } from "./compose-runtime-ownership";
import type { ExecutionTarget } from "./execution-target";
import type { DockerCommandResult, DockerTargetExecutor } from "./runtime-cleanup";

const composeTarget: ExecutionTarget = { mode: "local", serverKind: "docker-engine" };
const swarmTarget: ExecutionTarget = { mode: "local", serverKind: "docker-swarm-manager" };

const ownership: DockerOwnershipIdentity = {
  teamId: "team_test",
  projectId: "project_test",
  environmentId: "environment_test",
  serviceId: "service_test",
  deploymentId: "deployment_current"
};

function result(stdout: string[] = [], exitCode = 0): DockerCommandResult {
  return { exitCode, stdout, stderr: [] };
}

function inspectLine(id: string, labels: Record<string, string>): string {
  return [
    JSON.stringify(id),
    ...DOCKER_OWNERSHIP_LABEL_KEYS.map((key) => JSON.stringify(labels[key] ?? null))
  ].join("\t");
}

function executorFor(results: DockerCommandResult[]) {
  return vi
    .fn<DockerTargetExecutor>()
    .mockImplementation(() => Promise.resolve(results.shift() ?? result()));
}

describe("assertComposeRuntimeOwnership", () => {
  it("rejects an unowned Compose project collision", async () => {
    const execute = executorFor([
      result(["external-api"]),
      result([inspectLine("external-api", {})])
    ]);

    await expect(
      assertComposeRuntimeOwnership({
        kind: "compose",
        runtimeName: "demo",
        ownershipScopes: [ownership],
        target: composeTarget,
        onLog: vi.fn(),
        execute
      })
    ).rejects.toThrow('Compose project "demo" has an unowned container (external-api)');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("rejects a Swarm stack collision owned by another DaoFlow scope", async () => {
    const execute = executorFor([
      result(["service-1"]),
      result([
        inspectLine(
          "service-1",
          buildDockerOwnershipLabels({ ...ownership, projectId: "project_other" })
        )
      ])
    ]);

    await expect(
      assertComposeRuntimeOwnership({
        kind: "swarm",
        runtimeName: "demo-stack",
        ownershipScopes: [ownership],
        target: swarmTarget,
        onLog: vi.fn(),
        execute
      })
    ).rejects.toThrow('Swarm stack "demo-stack" has a differently owned service (service-1)');
    expect(execute).toHaveBeenCalledTimes(2);
  });

  it("allows matching Compose ownership from an earlier deployment", async () => {
    const existingLabels = buildDockerOwnershipLabels({
      ...ownership,
      deploymentId: "deployment_previous"
    });
    const execute = executorFor([
      result(["container-1"]),
      result([inspectLine("container-1", existingLabels)]),
      result(),
      result()
    ]);

    const snapshot = await assertComposeRuntimeOwnership({
      kind: "compose",
      runtimeName: "demo",
      ownershipScopes: [ownership],
      target: composeTarget,
      onLog: vi.fn(),
      execute
    });

    expect(snapshot).toEqual({
      containers: ["container-1"],
      networks: [],
      volumes: [],
      services: [],
      configs: [],
      secrets: []
    });
    expect(execute).toHaveBeenCalledTimes(4);
  });

  it("allows matching Swarm services and networks from an earlier deployment", async () => {
    const existingLabels = buildDockerOwnershipLabels({
      ...ownership,
      deploymentId: "deployment_previous"
    });
    const execute = executorFor([
      result(["service-1"]),
      result([inspectLine("service-1", existingLabels)]),
      result(["network-1"]),
      result([inspectLine("network-1", existingLabels)]),
      result(),
      result()
    ]);

    const snapshot = await assertComposeRuntimeOwnership({
      kind: "swarm",
      runtimeName: "demo-stack",
      ownershipScopes: [ownership],
      target: swarmTarget,
      onLog: vi.fn(),
      execute
    });

    expect(snapshot).toEqual({
      containers: [],
      networks: ["network-1"],
      volumes: [],
      services: ["service-1"],
      configs: [],
      secrets: []
    });
    expect(execute).toHaveBeenCalledTimes(6);
  });
});
