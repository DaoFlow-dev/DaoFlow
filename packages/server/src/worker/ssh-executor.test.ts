import { describe, expect, it, vi } from "vitest";
import type { LogLine } from "./docker-executor";
import { remoteDockerComposePull, remoteDockerComposeUp, type SSHTarget } from "./ssh-executor";

const target: SSHTarget = {
  serverName: "prod",
  host: "example.com",
  port: 22
};

function onLog(_line: LogLine) {
  return;
}

describe("remoteDockerComposePull", () => {
  it("scopes remote pull execution to the selected compose service", async () => {
    const execRemoteImpl = vi.fn().mockResolvedValueOnce({ exitCode: 0, signal: null });

    await remoteDockerComposePull(
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
        "docker compose -f '.daoflow.compose.rendered.yaml' -p 'demo' --env-file '.daoflow.compose.env' pull 'api'"
      ),
      onLog
    );
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
