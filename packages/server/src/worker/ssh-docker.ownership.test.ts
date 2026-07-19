import { describe, expect, it } from "vitest";
const labels = {
  "io.daoflow.managed": "true",
  "io.daoflow.team-id": "team_123",
  "io.daoflow.project-id": "project_123",
  "io.daoflow.environment-id": "environment_123",
  "io.daoflow.service-id": "service_123",
  "io.daoflow.deployment-id": "deployment_123"
} as const;

describe("remote Docker ownership arguments", () => {
  it("passes labels to remote docker build, run, and wrapper commands", async () => {
    const {
      buildRemoteDockerBuildScript,
      buildRemoteDockerMetadataWrapperCommand,
      buildRemoteDockerRunCommand
    } = await import("./ssh-docker");
    const buildScript = buildRemoteDockerBuildScript(
      "/work",
      "/work/Dockerfile",
      "daoflow/api:test",
      labels,
      []
    );
    const runCommand = buildRemoteDockerRunCommand("daoflow/api:test", "api", { labels });
    const wrapperCommand = buildRemoteDockerMetadataWrapperCommand(
      "ghcr.io/vendor/api:1",
      "daoflow-owned:deployment_123",
      labels
    );

    expect(buildScript).toContain("io.daoflow.team-id=team_123");
    expect(runCommand).toContain("io.daoflow.service-id=service_123");
    expect(wrapperCommand).toContain("BASE_IMAGE=ghcr.io/vendor/api:1");
    expect(wrapperCommand).toContain("daoflow-owned:deployment_123");
  });
});
