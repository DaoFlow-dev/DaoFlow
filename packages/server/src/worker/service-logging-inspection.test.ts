import { describe, expect, it } from "vitest";
import type { ResolvedServiceRuntime } from "../db/services/service-runtime";
import {
  inspectServiceLogging,
  parseDockerLoggingInspectLines
} from "./service-logging-inspection";

const desired = {
  managed: true as const,
  driver: "json-file" as const,
  maxSizeMb: 10,
  maxFiles: 3,
  allowSourceOverride: false
};

function composeRuntime(
  target: Extract<ResolvedServiceRuntime, { kind: "compose" }>["target"]
): Extract<ResolvedServiceRuntime, { kind: "compose" }> {
  return {
    kind: "compose",
    service: {} as Extract<ResolvedServiceRuntime, { kind: "compose" }>["service"],
    deployment: {} as Extract<ResolvedServiceRuntime, { kind: "compose" }>["deployment"],
    server: {} as Extract<ResolvedServiceRuntime, { kind: "compose" }>["server"],
    target,
    projectName: "demo",
    composeServiceName: "api"
  };
}

function containerRuntime(
  target: Extract<ResolvedServiceRuntime, { kind: "container" }>["target"]
): Extract<ResolvedServiceRuntime, { kind: "container" }> {
  return {
    kind: "container",
    service: {} as Extract<ResolvedServiceRuntime, { kind: "container" }>["service"],
    deployment: {} as Extract<ResolvedServiceRuntime, { kind: "container" }>["deployment"],
    server: {} as Extract<ResolvedServiceRuntime, { kind: "container" }>["server"],
    target,
    containerName: "standalone-api"
  };
}

describe("service logging inspection", () => {
  it("parses only the safe Docker logging fields", () => {
    expect(
      parseDockerLoggingInspectLines([
        '/api\t{"Type":"json-file","Config":{"max-size":"10m","max-file":"3","secret":"ignored"}}',
        '/worker\t{"Config":{"max-size":"20m"}}',
        "not inspect output"
      ])
    ).toEqual([
      { name: "api", driver: "json-file", maxSize: "10m", maxFiles: "3" },
      { name: "worker", driver: null, maxSize: "20m", maxFiles: null }
    ]);
  });

  it("inspects stopped local Compose containers and reports mixed alignment", async () => {
    const calls: Array<{ mode: string; args: string[] }> = [];
    const result = await inspectServiceLogging({
      runtime: composeRuntime({ mode: "local", serverKind: "docker-engine" }),
      desired,
      runDockerCommand: (target, args) => {
        calls.push({ mode: target.mode, args });
        if (args[0] === "ps") {
          return Promise.resolve({
            exitCode: 0,
            stdout: [
              JSON.stringify({ Names: "demo-api-1", State: "exited", Status: "Exited (0)" }),
              JSON.stringify({ Names: "demo-api-2", State: "running", Status: "Up 1 minute" })
            ]
          });
        }
        return Promise.resolve({
          exitCode: 0,
          stdout: [
            '/demo-api-1\t{"Type":"json-file","Config":{"max-size":"10m","max-file":"3"}}',
            '/demo-api-2\t{"Type":"json-file","Config":{"max-size":"20m","max-file":"3"}}'
          ]
        });
      }
    });

    expect(calls[0]?.mode).toBe("local");
    expect(calls[0]?.args.slice(0, 2)).toEqual(["ps", "-a"]);
    expect(calls[1]?.args).toContain("inspect");
    expect(result).toEqual({
      status: "mixed",
      reason: null,
      containers: [
        {
          name: "demo-api-1",
          driver: "json-file",
          maxSize: "10m",
          maxFiles: "3",
          matchesDesired: true
        },
        {
          name: "demo-api-2",
          driver: "json-file",
          maxSize: "20m",
          maxFiles: "3",
          matchesDesired: false
        }
      ]
    });
  });

  it("uses the remote execution target and marks Swarm as unavailable without inspection", async () => {
    const remoteTarget = {
      mode: "remote" as const,
      serverKind: "docker-engine",
      remoteWorkDir: "/tmp/daoflow",
      ssh: { serverName: "qa", host: "203.0.113.8", port: 22 }
    };
    const remoteCalls: string[] = [];
    const remoteResult = await inspectServiceLogging({
      runtime: containerRuntime(remoteTarget),
      desired,
      runDockerCommand: (target, args) => {
        remoteCalls.push(target.mode);
        expect(args[0]).toBe("inspect");
        return Promise.resolve({
          exitCode: 0,
          stdout: [
            '/standalone-api\t{"Type":"json-file","Config":{"max-size":"10m","max-file":"3"}}'
          ]
        });
      }
    });

    expect(remoteCalls).toEqual(["remote"]);
    expect(remoteResult.status).toBe("aligned");

    const swarmRunner = () =>
      Promise.reject(new Error("Swarm inspection must not run through docker inspect."));
    await expect(
      inspectServiceLogging({
        runtime: composeRuntime({ mode: "local", serverKind: "docker-swarm-manager" }),
        desired,
        runDockerCommand: swarmRunner
      })
    ).resolves.toEqual({
      status: "unsupported",
      reason: "Docker Swarm logging inspection is not supported yet.",
      containers: []
    });
  });

  it("shows active settings without claiming alignment when management is cleared", async () => {
    const result = await inspectServiceLogging({
      runtime: containerRuntime({ mode: "local", serverKind: "docker-engine" }),
      desired: null,
      runDockerCommand: () =>
        Promise.resolve({
          exitCode: 0,
          stdout: [
            '/standalone-api\t{"Type":"json-file","Config":{"max-size":"10m","max-file":"3"}}'
          ]
        })
    });

    expect(result).toEqual({
      status: "not-managed",
      reason: null,
      containers: [
        {
          name: "standalone-api",
          driver: "json-file",
          maxSize: "10m",
          maxFiles: "3",
          matchesDesired: null
        }
      ]
    });
  });
});
