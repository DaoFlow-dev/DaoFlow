import { describe, expect, it, vi } from "vitest";
import type { LogLine } from "./docker-executor";
import {
  remoteDockerComposePs,
  remoteDockerComposeDown,
  remoteDockerComposePull,
  remoteDockerComposeUp,
  type SSHTarget
} from "./ssh-executor";

const target: SSHTarget = {
  serverName: "prod",
  host: "example.com",
  port: 22
};

function onLog(_line: LogLine) {
  return;
}

function createLogCollector() {
  const lines: LogLine[] = [];
  return {
    lines,
    onLog: (line: LogLine) => {
      lines.push(line);
    }
  };
}

describe("remoteDockerComposePull", () => {
  it("scopes remote pull execution to the selected compose service", async () => {
    const collector = createLogCollector();
    const execRemoteImpl = vi.fn().mockResolvedValueOnce({ exitCode: 0, signal: null });

    await remoteDockerComposePull(
      target,
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/srv/demo",
      collector.onLog,
      ".daoflow.compose.env",
      "api",
      execRemoteImpl
    );

    expect(execRemoteImpl).toHaveBeenCalledWith(
      target,
      expect.stringContaining(
        'env -i DOCKER_CLI_HINTS=false PATH="${PATH}" HOME="${HOME}" DOCKER_CONFIG="${DOCKER_CONFIG}"'
      ),
      collector.onLog
    );
    expect(execRemoteImpl).toHaveBeenCalledWith(
      target,
      expect.stringContaining(
        "docker compose -f '.daoflow.compose.rendered.yaml' -p 'demo' --env-file '.daoflow.compose.env' pull 'api'"
      ),
      collector.onLog
    );
    expect(
      collector.lines.some((line) =>
        line.message.includes("Compose execution env isolated from ambient remote shell env")
      )
    ).toBe(true);
  });
});

describe("remoteDockerComposeUp", () => {
  it("scopes remote up execution to the selected compose service", async () => {
    const execRemoteImpl = vi.fn().mockResolvedValueOnce({ exitCode: 0, signal: null });

    await remoteDockerComposeUp(
      target,
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/srv/demo",
      onLog,
      ".daoflow.compose.env",
      "api",
      execRemoteImpl
    );

    expect(execRemoteImpl).toHaveBeenCalledWith(
      target,
      expect.stringContaining(
        "docker compose -f '.daoflow.compose.rendered.yaml' -p 'demo' --env-file '.daoflow.compose.env' up -d --remove-orphans 'api'"
      ),
      onLog
    );
  });
});

describe("remoteDockerComposePs", () => {
  it("reads machine-readable remote compose status for the selected service", async () => {
    const execRemoteImpl = vi
      .fn()
      .mockImplementationOnce((_target, _command, onLog: (line: LogLine) => void) => {
        onLog({
          stream: "stdout",
          message: JSON.stringify({
            Service: "api",
            Name: "demo-api-1",
            State: "running",
            Status: "Up 2 seconds (healthy)",
            Health: "healthy",
            ExitCode: 0
          }),
          timestamp: new Date()
        });
        return Promise.resolve({ exitCode: 0, signal: null });
      });

    const result = await remoteDockerComposePs(
      target,
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/srv/demo",
      onLog,
      ".daoflow.compose.env",
      "api",
      execRemoteImpl
    );

    expect(execRemoteImpl).toHaveBeenCalledWith(
      target,
      expect.stringContaining(
        "docker compose -f '.daoflow.compose.rendered.yaml' -p 'demo' --env-file '.daoflow.compose.env' ps --format json 'api'"
      ),
      expect.any(Function)
    );
    expect(result).toEqual({
      exitCode: 0,
      statuses: [
        {
          service: "api",
          name: "demo-api-1",
          state: "running",
          status: "Up 2 seconds (healthy)",
          health: "healthy",
          exitCode: 0
        }
      ]
    });
  });
});

describe("remoteDockerComposeDown", () => {
  it("stops remote compose services with the same isolated env contract", async () => {
    const collector = createLogCollector();
    const execRemoteImpl = vi.fn().mockResolvedValueOnce({ exitCode: 0, signal: null });

    await remoteDockerComposeDown(
      target,
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/srv/demo",
      collector.onLog,
      ".daoflow.compose.env",
      execRemoteImpl
    );

    expect(execRemoteImpl).toHaveBeenCalledWith(
      target,
      expect.stringContaining(
        "docker compose -f '.daoflow.compose.rendered.yaml' -p 'demo' --env-file '.daoflow.compose.env' down"
      ),
      collector.onLog
    );
  });
});
