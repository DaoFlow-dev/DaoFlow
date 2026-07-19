import { describe, expect, it, vi } from "vitest";
import type { DockerCommandResult, DockerTargetExecutor } from "./runtime-cleanup";
import type { ExecutionTarget } from "./execution-target";
import { inspectDockerOwnedResources } from "./docker-owned-resource-inspection";
import { DOCKER_OWNERSHIP_LABEL_KEYS } from "../docker-ownership";

const localTarget: ExecutionTarget = { mode: "local", serverKind: "docker-engine" };
const swarmTarget: ExecutionTarget = { mode: "local", serverKind: "docker-swarm-manager" };
const remoteTarget: ExecutionTarget = {
  mode: "remote",
  serverKind: "docker-engine",
  ssh: { serverName: "qa", host: "example.com", port: 22 },
  remoteWorkDir: "/tmp/daoflow-inspection"
};

function result(stdout: string[] = [], exitCode = 0): DockerCommandResult {
  return { exitCode, stdout, stderr: [] };
}

function executorFor(results: DockerCommandResult[]) {
  return vi
    .fn<DockerTargetExecutor>()
    .mockImplementation(() => Promise.resolve(results.shift() ?? result()));
}

function inspectLine(id: string, name: unknown, labels: Record<string, string>): string {
  return [
    JSON.stringify(id),
    JSON.stringify(name),
    ...DOCKER_OWNERSHIP_LABEL_KEYS.map((key) => JSON.stringify(labels[key] ?? null))
  ].join("\t");
}

function inspectFormat(id: string, name: string, labels: string): string {
  return [
    `{{json ${id}}}`,
    `{{json ${name}}}`,
    ...DOCKER_OWNERSHIP_LABEL_KEYS.map((key) => `{{json (index ${labels} "${key}")}}`)
  ].join("\t");
}

function listLine(id: string, name: string): string {
  return [JSON.stringify(id), JSON.stringify(name)].join("\t");
}

describe("inspectDockerOwnedResources", () => {
  it("collects managed containers, images, networks, and volumes with sorted labels", async () => {
    const execute = executorFor([
      result([listLine("container-2", "api"), listLine("container-1", "web")]),
      result([
        inspectLine("container-2-full", "/api", {
          "io.daoflow.project-id": "project-1",
          "io.daoflow.managed": "true",
          "user.secret": "must-not-be-collected"
        }),
        inspectLine("container-1-full", "/web", { "io.daoflow.managed": "true" })
      ]),
      result([listLine("image-1", "example/web:latest")]),
      result([
        inspectLine("image-1-full", null, {
          "io.daoflow.managed": "true",
          "io.daoflow.deployment-id": "deploy-1"
        })
      ]),
      result([listLine("network-1", "daoflow-net")]),
      result([inspectLine("network-1-full", "daoflow-net", { "io.daoflow.managed": "true" })]),
      result([listLine("volume-1", "daoflow-data")]),
      result([inspectLine("volume-1-full", "daoflow-data", { "io.daoflow.managed": "true" })])
    ]);

    const snapshot = await inspectDockerOwnedResources(localTarget, vi.fn(), execute);

    expect(snapshot).toEqual({
      checkedAt: expect.any(String),
      containers: [
        {
          id: "container-1-full",
          name: "web",
          labels: { "io.daoflow.managed": "true" }
        },
        {
          id: "container-2-full",
          name: "api",
          labels: {
            "io.daoflow.managed": "true",
            "io.daoflow.project-id": "project-1"
          }
        }
      ],
      images: [
        {
          id: "image-1-full",
          name: "example/web:latest",
          labels: {
            "io.daoflow.deployment-id": "deploy-1",
            "io.daoflow.managed": "true"
          }
        }
      ],
      networks: [
        { id: "network-1-full", name: "daoflow-net", labels: { "io.daoflow.managed": "true" } }
      ],
      volumes: [
        { id: "volume-1-full", name: "daoflow-data", labels: { "io.daoflow.managed": "true" } }
      ],
      services: [],
      issues: []
    });
    expect(JSON.stringify(snapshot)).not.toContain("must-not-be-collected");

    expect(execute.mock.calls.map((call) => call[1])).toEqual([
      [
        "ps",
        "--all",
        "--filter",
        "label=io.daoflow.managed=true",
        "--format",
        "{{json .ID}}\t{{json .Names}}"
      ],
      [
        "inspect",
        "--type",
        "container",
        "--format",
        inspectFormat(".Id", ".Name", ".Config.Labels"),
        "container-2",
        "container-1"
      ],
      [
        "image",
        "ls",
        "--all",
        "--filter",
        "label=io.daoflow.managed=true",
        "--format",
        '{{json .ID}}\t{{json (printf "%s:%s" .Repository .Tag)}}'
      ],
      [
        "image",
        "inspect",
        "--format",
        inspectFormat(".Id", ".RepoTags", ".Config.Labels"),
        "image-1"
      ],
      [
        "network",
        "ls",
        "--filter",
        "label=io.daoflow.managed=true",
        "--format",
        "{{json .ID}}\t{{json .Name}}"
      ],
      ["network", "inspect", "--format", inspectFormat(".Id", ".Name", ".Labels"), "network-1"],
      [
        "volume",
        "ls",
        "--filter",
        "label=io.daoflow.managed=true",
        "--format",
        "{{json .Name}}\t{{json .Name}}"
      ],
      ["volume", "inspect", "--format", inspectFormat(".Name", ".Name", ".Labels"), "volume-1"]
    ]);
  });

  it("inspects Swarm services only on a Swarm manager", async () => {
    const execute = executorFor([
      ...Array.from({ length: 4 }, () => result()),
      result([listLine("service-1", "web")]),
      result([inspectLine("service-1", "web", { "io.daoflow.managed": "true" })])
    ]);

    const snapshot = await inspectDockerOwnedResources(swarmTarget, vi.fn(), execute);

    expect(snapshot.services).toEqual([
      { id: "service-1", name: "web", labels: { "io.daoflow.managed": "true" } }
    ]);
    expect(execute.mock.calls.at(-2)?.[1]).toEqual([
      "service",
      "ls",
      "--filter",
      "label=io.daoflow.managed=true",
      "--format",
      "{{json .ID}}\t{{json .Name}}"
    ]);

    const engineExecute = executorFor(Array.from({ length: 8 }, () => result()));
    const engineSnapshot = await inspectDockerOwnedResources(localTarget, vi.fn(), engineExecute);
    expect(engineSnapshot.services).toEqual([]);
    expect(engineExecute.mock.calls.some((call) => call[1]?.[0] === "service")).toBe(false);
  });

  it("reports malformed output, invalid labels, and command failures without exposing raw data", async () => {
    const secret = "PASSWORD=do-not-return";
    const execute = executorFor([
      result(["not-json\tstill-not-json", "malformed"]),
      result([listLine("image-1", "example/app:latest")]),
      result([
        inspectLine("image-1", "", { "io.daoflow.managed": "false" }),
        `${JSON.stringify("image-2")}\t${JSON.stringify([])}\t${secret}`
      ]),
      result([], 17),
      result([], 23)
    ]);

    const snapshot = await inspectDockerOwnedResources(localTarget, vi.fn(), execute);

    expect(snapshot.containers).toEqual([]);
    expect(snapshot.images).toEqual([]);
    expect(snapshot.issues).toEqual([
      { resourceType: "container", code: "malformed-list-entry", line: 1 },
      { resourceType: "container", code: "malformed-list-entry", line: 2 },
      { resourceType: "image", code: "malformed-inspect-entry", line: 2 },
      { resourceType: "image", code: "missing-inspection" },
      { resourceType: "image", code: "not-managed", line: 1 },
      { resourceType: "network", code: "command-failed", exitCode: 17 },
      { resourceType: "volume", code: "command-failed", exitCode: 23 }
    ]);
    expect(JSON.stringify(snapshot)).not.toContain(secret);
  });

  it("continues after an executor failure and reports missing inspections", async () => {
    const execute = vi.fn<DockerTargetExecutor>().mockImplementation((_target, args) => {
      if (args[0] === "ps") return Promise.reject(new Error("spawn failed"));
      if (args[0] === "image" && args[1] === "ls") {
        return Promise.resolve(result([listLine("image-1", "example/app:latest")]));
      }
      if (args[0] === "image" && args[1] === "inspect") return Promise.resolve(result([]));
      return Promise.resolve(result());
    });

    const snapshot = await inspectDockerOwnedResources(localTarget, vi.fn(), execute);

    expect(snapshot.containers).toEqual([]);
    expect(snapshot.issues).toContainEqual({
      resourceType: "container",
      code: "execution-failed"
    });
  });

  it("passes remote targets and the log callback to the shared executor", async () => {
    const execute = executorFor(Array.from({ length: 8 }, () => result()));
    const onLog = vi.fn();

    await inspectDockerOwnedResources(remoteTarget, onLog, execute);

    expect(execute).toHaveBeenCalledWith(
      remoteTarget,
      expect.arrayContaining(["--filter", "label=io.daoflow.managed=true"]),
      onLog
    );
  });
});
