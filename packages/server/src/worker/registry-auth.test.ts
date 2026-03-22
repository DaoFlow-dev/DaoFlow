import { describe, expect, it } from "vitest";
import { buildRegistryAwareShellCommand, wrapDockerCommandWithRegistryAuth } from "./registry-auth";

const registries = [
  {
    id: "reg_123",
    registryHost: "ghcr.io",
    username: "octocat",
    password: "token'value"
  }
];

describe("buildRegistryAwareShellCommand", () => {
  it("returns the original command when no registries are provided", () => {
    expect(buildRegistryAwareShellCommand("docker pull redis:7", [])).toBe("docker pull redis:7");
  });

  it("wraps the command with isolated docker config and login steps", () => {
    const command = buildRegistryAwareShellCommand(
      "docker pull ghcr.io/acme/api:latest",
      registries
    );

    expect(command).toContain('docker_config_dir="$(mktemp -d)"');
    expect(command).toContain('export DOCKER_CONFIG="$docker_config_dir"');
    expect(command).toContain("docker login 'ghcr.io' -u 'octocat' --password-stdin >/dev/null");
    expect(command).toContain("docker pull ghcr.io/acme/api:latest");
    expect(command).toContain("'token'\\''value'");
  });
});

describe("wrapDockerCommandWithRegistryAuth", () => {
  it("keeps the original docker command when no auth is required", () => {
    expect(
      wrapDockerCommandWithRegistryAuth({
        command: "docker",
        args: ["pull", "redis:7"],
        registries: []
      })
    ).toEqual({
      command: "docker",
      args: ["pull", "redis:7"]
    });
  });

  it("switches to shell execution when registry auth is required", () => {
    const wrapped = wrapDockerCommandWithRegistryAuth({
      command: "docker",
      args: ["pull", "ghcr.io/acme/api:latest"],
      registries
    });

    expect(wrapped.command).toBe("sh");
    expect(wrapped.args).toEqual([]);
    expect(wrapped.stdin).toContain("'docker' 'pull' 'ghcr.io/acme/api:latest'");
    expect(wrapped.stdin).toContain("docker login 'ghcr.io'");
  });
});
