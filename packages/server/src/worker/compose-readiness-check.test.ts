import { describe, expect, it, vi } from "vitest";
import type { LogLine } from "./docker-executor";
import {
  runLocalComposeReadinessCheck,
  runRemoteComposeReadinessCheck
} from "./compose-readiness-check";
import type { ComposeReadinessProbeSnapshot } from "../compose-readiness";
import type { SSHTarget } from "./ssh-connection";

const probe: ComposeReadinessProbeSnapshot = {
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

const target: SSHTarget = {
  serverName: "prod",
  host: "example.com",
  port: 22
};

function onLog(_line: LogLine) {
  return;
}

describe("runLocalComposeReadinessCheck", () => {
  it("passes when the published readiness endpoint returns an accepted status", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 204 }));

    await expect(
      runLocalComposeReadinessCheck(probe, fetchImpl as unknown as typeof fetch)
    ).resolves.toEqual({
      kind: "success",
      summary: "api readiness probe passed at http://127.0.0.1:8080/ready (HTTP 204)"
    });
  });

  it("stays pending on explicit client errors that indicate the target is not yet ready", async () => {
    const fetchImpl = vi.fn().mockResolvedValueOnce(new Response(null, { status: 404 }));

    await expect(
      runLocalComposeReadinessCheck(probe, fetchImpl as unknown as typeof fetch)
    ).resolves.toEqual({
      kind: "pending",
      summary: "api readiness probe is still waiting on http://127.0.0.1:8080/ready (HTTP 404)"
    });
  });

  it("stays pending on transient connection errors", async () => {
    const fetchImpl = vi.fn().mockRejectedValueOnce(new Error("connect ECONNREFUSED 127.0.0.1"));

    await expect(
      runLocalComposeReadinessCheck(probe, fetchImpl as unknown as typeof fetch)
    ).resolves.toEqual({
      kind: "pending",
      summary:
        "api readiness probe is still waiting on http://127.0.0.1:8080/ready (connect ECONNREFUSED 127.0.0.1)"
    });
  });
});

describe("runRemoteComposeReadinessCheck", () => {
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

    await expect(runRemoteComposeReadinessCheck(target, probe, onLog, execImpl)).resolves.toEqual({
      kind: "success",
      summary: "api readiness probe passed at http://127.0.0.1:8080/ready (HTTP 200)"
    });
  });

  it("stays pending when the remote endpoint returns a client error", async () => {
    const execImpl = vi
      .fn()
      .mockImplementationOnce((_target, _command, execOnLog: (line: LogLine) => void) => {
        execOnLog({
          stream: "stdout",
          message: "404",
          timestamp: new Date()
        });
        return Promise.resolve({ exitCode: 0, signal: null });
      });

    await expect(runRemoteComposeReadinessCheck(target, probe, onLog, execImpl)).resolves.toEqual({
      kind: "pending",
      summary: "api readiness probe is still waiting on http://127.0.0.1:8080/ready (HTTP 404)"
    });
  });

  it("stays pending while the target port is not yet accepting connections", async () => {
    const execImpl = vi.fn().mockResolvedValueOnce({ exitCode: 7, signal: null });

    await expect(runRemoteComposeReadinessCheck(target, probe, onLog, execImpl)).resolves.toEqual({
      kind: "pending",
      summary: "api readiness probe is still waiting on http://127.0.0.1:8080/ready (curl exit 7)"
    });
  });
});
