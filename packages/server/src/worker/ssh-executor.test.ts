import { describe, expect, it, vi } from "vitest";
import type { LogLine } from "./docker-executor";
import {
  remoteDockerComposeBuild,
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
      ".daoflow.compose.export.sh",
      "api",
      undefined,
      execRemoteImpl
    );

    expect(execRemoteImpl).toHaveBeenCalledTimes(1);
    const command = String(execRemoteImpl.mock.calls[0]?.[1] ?? "");
    const options = execRemoteImpl.mock.calls[0]?.[3];
    expect(command).toBe("sh");
    expect(options?.stdin).toContain('env -i DOCKER_CLI_HINTS=false PATH="${PATH:-}"');
    expect(options?.stdin).toContain(".daoflow.compose.export.sh");
    expect(options?.stdin).toContain("docker compose");
    expect(options?.stdin).toContain("--env-file");
    expect(options?.stdin).toContain(" pull --ignore-buildable --include-deps ");
    expect(options?.stdin).toContain("api");
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
      ".daoflow.compose.export.sh",
      "api",
      undefined,
      execRemoteImpl
    );

    expect(execRemoteImpl).toHaveBeenCalledTimes(1);
    const command = String(execRemoteImpl.mock.calls[0]?.[1] ?? "");
    const options = execRemoteImpl.mock.calls[0]?.[3];
    expect(command).toBe("sh");
    expect(options?.stdin).toContain(".daoflow.compose.export.sh");
    expect(options?.stdin).toContain("docker compose");
    expect(options?.stdin).toContain(" up -d --remove-orphans ");
    expect(options?.stdin).toContain("api");
  });

  it("uses stdin for authenticated remote compose up scripts", async () => {
    const execRemoteImpl = vi.fn().mockResolvedValueOnce({ exitCode: 0, signal: null });

    await remoteDockerComposeUp(
      target,
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/srv/demo",
      onLog,
      ".daoflow.compose.env",
      ".daoflow.compose.export.sh",
      "api",
      [
        {
          id: "reg_123",
          registryHost: "ghcr.io",
          username: "octocat",
          password: "topsecret"
        }
      ],
      execRemoteImpl
    );

    expect(execRemoteImpl).toHaveBeenCalledWith(
      target,
      "sh",
      onLog,
      expect.objectContaining({
        stdin: expect.stringContaining("docker login 'ghcr.io'"),
        preview: expect.stringContaining("docker compose -f .daoflow.compose.rendered.yaml")
      })
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
      ".daoflow.compose.export.sh",
      "api",
      execRemoteImpl
    );

    expect(execRemoteImpl).toHaveBeenCalledTimes(1);
    const command = String(execRemoteImpl.mock.calls[0]?.[1] ?? "");
    const options = execRemoteImpl.mock.calls[0]?.[3];
    expect(command).toBe("sh");
    expect(options?.stdin).toContain(".daoflow.compose.export.sh");
    expect(options?.stdin).toContain("docker compose");
    expect(options?.stdin).toContain(" ps --format json ");
    expect(options?.stdin).toContain("api");
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
      ".daoflow.compose.export.sh",
      execRemoteImpl
    );

    expect(execRemoteImpl).toHaveBeenCalledTimes(1);
    const command = String(execRemoteImpl.mock.calls[0]?.[1] ?? "");
    const options = execRemoteImpl.mock.calls[0]?.[3];
    expect(command).toBe("sh");
    expect(options?.stdin).toContain(".daoflow.compose.export.sh");
    expect(options?.stdin).toContain("docker compose");
    expect(options?.stdin).toContain(" down");
  });
});

describe("remoteDockerComposeBuild", () => {
  it("sources the generated export file and enables BuildKit for remote builds", async () => {
    const execRemoteImpl = vi.fn().mockResolvedValueOnce({ exitCode: 0, signal: null });

    await remoteDockerComposeBuild(
      target,
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/srv/demo",
      onLog,
      ".daoflow.compose.env",
      ".daoflow.compose.export.sh",
      "api",
      undefined,
      execRemoteImpl
    );

    expect(execRemoteImpl).toHaveBeenCalledTimes(1);
    const command = String(execRemoteImpl.mock.calls[0]?.[1] ?? "");
    const options = execRemoteImpl.mock.calls[0]?.[3];
    expect(command).toBe("sh");
    expect(options?.stdin).toContain(".daoflow.compose.export.sh");
    expect(options?.stdin).toContain("DOCKER_BUILDKIT=1");
    expect(options?.stdin).toContain("COMPOSE_DOCKER_CLI_BUILD=1");
    expect(options?.stdin).toContain("docker compose");
    expect(options?.stdin).toContain(" build --with-dependencies ");
    expect(options?.stdin).toContain(" build ");
    expect(options?.stdin).toContain("api");
  });
});
