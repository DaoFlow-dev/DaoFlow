import { createServer } from "node:net";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ComposeReadinessProbeSnapshot } from "../compose-readiness";
import type { ComposeContainerStatus } from "./compose-health";
import {
  runLocalComposeReadinessCheck,
  runRemoteComposeReadinessCheck
} from "./compose-readiness-check";
import type { LogLine } from "./docker-executor";
import type { SSHTarget } from "./ssh-connection";

const publishedHttpProbe: ComposeReadinessProbeSnapshot = {
  serviceName: "api",
  type: "http",
  target: "published-port",
  host: "127.0.0.1",
  scheme: "http",
  port: 8080,
  path: "/ready",
  timeoutSeconds: 60,
  intervalSeconds: 3,
  successStatusCodes: [200, 204]
};

const internalHttpProbe: ComposeReadinessProbeSnapshot = {
  serviceName: "api",
  type: "http",
  target: "internal-network",
  scheme: "http",
  port: 8080,
  path: "/ready",
  timeoutSeconds: 60,
  intervalSeconds: 3,
  successStatusCodes: [200]
};

const publishedTcpProbe: ComposeReadinessProbeSnapshot = {
  serviceName: "db",
  type: "tcp",
  target: "published-port",
  host: "127.0.0.1",
  port: 5432,
  timeoutSeconds: 60,
  intervalSeconds: 3
};

const internalTcpProbe: ComposeReadinessProbeSnapshot = {
  serviceName: "db",
  type: "tcp",
  target: "internal-network",
  port: 5432,
  timeoutSeconds: 60,
  intervalSeconds: 3
};

const runningStatuses: ComposeContainerStatus[] = [
  {
    service: "api",
    name: "demo-api-1",
    state: "running",
    status: "Up 2 seconds (healthy)",
    health: "healthy",
    exitCode: 0
  },
  {
    service: "db",
    name: "demo-db-1",
    state: "running",
    status: "Up 2 seconds (healthy)",
    health: "healthy",
    exitCode: 0
  }
];

const target: SSHTarget = {
  serverName: "prod",
  host: "example.com",
  port: 22
};

function onLog(_line: LogLine) {
  return;
}

describe("runLocalComposeReadinessCheck", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when the published readiness endpoint returns an accepted status", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      runLocalComposeReadinessCheck(publishedHttpProbe, [], fetchImpl as unknown as typeof fetch)
    ).resolves.toEqual({
      kind: "success",
      summary: "api readiness probe passed at http://127.0.0.1:8080/ready (HTTP 204)"
    });
  });

  it("stays pending on explicit client errors that indicate the target is not yet ready", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(
      runLocalComposeReadinessCheck(publishedHttpProbe, [], fetchImpl as unknown as typeof fetch)
    ).resolves.toEqual({
      kind: "pending",
      summary: "api readiness probe is still waiting on http://127.0.0.1:8080/ready (HTTP 404)"
    });
  });

  it("passes internal-network HTTP readiness after resolving running container addresses", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 200 }));
    const execRunner = vi
      .fn()
      .mockImplementationOnce((_command, _args, _cwd, execOnLog: (line: LogLine) => void) => {
        execOnLog({
          stream: "stdout",
          message: "172.20.0.10",
          timestamp: new Date()
        });
        return Promise.resolve({ exitCode: 0, signal: null });
      });

    await expect(
      runLocalComposeReadinessCheck(
        internalHttpProbe,
        runningStatuses,
        fetchImpl as unknown as typeof fetch,
        execRunner
      )
    ).resolves.toEqual({
      kind: "success",
      summary:
        "api readiness probe passed at http://api:8080/ready (1/1 container responded successfully)"
    });
  });

  it("passes published TCP readiness when the socket accepts connections", async () => {
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", () => resolve());
    });

    try {
      const address = server.address();
      if (!address || typeof address === "string") {
        throw new Error("Expected a TCP server address.");
      }

      await expect(
        runLocalComposeReadinessCheck(
          {
            ...publishedTcpProbe,
            port: address.port
          },
          []
        )
      ).resolves.toEqual({
        kind: "success",
        summary: `db readiness probe passed at tcp://127.0.0.1:${address.port} (TCP connect)`
      });
    } finally {
      server.close();
    }
  });

  it("stays pending when no internal-network container addresses are available yet", async () => {
    await expect(runLocalComposeReadinessCheck(internalTcpProbe, [])).resolves.toEqual({
      kind: "pending",
      summary:
        "db readiness probe is still waiting on tcp://db:5432 (no running container addresses are available yet)"
    });
  });
});

describe("runRemoteComposeReadinessCheck", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("passes when curl on the target reports an accepted HTTP status", async () => {
    const execImpl = vi
      .fn()
      .mockImplementationOnce((_target, _command, execOnLog: (line: LogLine) => void) => {
        execOnLog({
          stream: "stdout",
          message: "200",
          timestamp: new Date()
        });
        return Promise.resolve({ exitCode: 0, signal: null });
      });

    await expect(
      runRemoteComposeReadinessCheck(target, publishedHttpProbe, [], onLog, execImpl)
    ).resolves.toEqual({
      kind: "success",
      summary: "api readiness probe passed at http://127.0.0.1:8080/ready (HTTP 200)"
    });
  });

  it("passes internal-network HTTP readiness after resolving running container addresses", async () => {
    const execImpl = vi
      .fn()
      .mockImplementationOnce((_target, _command, execOnLog: (line: LogLine) => void) => {
        execOnLog({
          stream: "stdout",
          message: "172.20.0.10",
          timestamp: new Date()
        });
        return Promise.resolve({ exitCode: 0, signal: null });
      })
      .mockImplementationOnce((_target, _command, execOnLog: (line: LogLine) => void) => {
        execOnLog({
          stream: "stdout",
          message: "200",
          timestamp: new Date()
        });
        return Promise.resolve({ exitCode: 0, signal: null });
      });

    await expect(
      runRemoteComposeReadinessCheck(target, internalHttpProbe, runningStatuses, onLog, execImpl)
    ).resolves.toEqual({
      kind: "success",
      summary:
        "api readiness probe passed at http://api:8080/ready (1/1 container responded successfully)"
    });
    expect(execImpl.mock.calls[0]?.[1]).toContain("docker inspect");
    expect(execImpl.mock.calls[1]?.[1]).toContain("curl");
  });

  it("passes published TCP readiness when the remote shell can open the socket", async () => {
    const execImpl = vi.fn().mockResolvedValueOnce({ exitCode: 0, signal: null });

    await expect(
      runRemoteComposeReadinessCheck(target, publishedTcpProbe, [], onLog, execImpl)
    ).resolves.toEqual({
      kind: "success",
      summary: "db readiness probe passed at tcp://127.0.0.1:5432 (TCP connect)"
    });
    expect(execImpl.mock.calls[0]?.[1]).toContain("bash -lc");
    expect(execImpl.mock.calls[0]?.[1]).toContain("/dev/tcp/127.0.0.1/5432");
  });

  it("fails with a clear error when remote HTTP readiness requires curl but it is missing", async () => {
    const execImpl = vi.fn().mockResolvedValueOnce({ exitCode: 127, signal: null });

    await expect(
      runRemoteComposeReadinessCheck(target, publishedHttpProbe, [], onLog, execImpl)
    ).resolves.toEqual({
      kind: "failed",
      summary: "Remote readiness probe requires curl on prod; install curl and retry api."
    });
  });
});
