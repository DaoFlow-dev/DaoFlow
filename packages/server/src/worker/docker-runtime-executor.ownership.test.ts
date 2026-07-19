import { describe, expect, it } from "vitest";

const labels = {
  "io.daoflow.managed": "true",
  "io.daoflow.team-id": "team_123",
  "io.daoflow.project-id": "project_123",
  "io.daoflow.environment-id": "environment_123",
  "io.daoflow.service-id": "service_123",
  "io.daoflow.deployment-id": "deployment_123"
} as const;

describe("local Docker ownership arguments", () => {
  it("passes labels to docker build, docker run, and the metadata wrapper", async () => {
    const { buildDockerBuildArgs, buildDockerRunArgs } = await import("./docker-runtime-executor");
    const { buildDockerMetadataWrapperArgs } = await import("./docker-ownership-executor");
    const buildArgs = buildDockerBuildArgs("/work/Dockerfile", "daoflow/api:test", labels);
    const runArgs = buildDockerRunArgs("daoflow/api:test", "api", { labels });
    const wrapperArgs = buildDockerMetadataWrapperArgs(
      "ghcr.io/vendor/api:1",
      "daoflow-owned:deployment_123",
      labels
    );

    expect(buildArgs).toEqual(
      expect.arrayContaining([
        "build",
        "--label",
        "io.daoflow.team-id=team_123",
        "-t",
        "daoflow/api:test"
      ])
    );
    expect(runArgs).toEqual(
      expect.arrayContaining([
        "run",
        "--label",
        "io.daoflow.service-id=service_123",
        "daoflow/api:test"
      ])
    );
    expect(wrapperArgs).toEqual(
      expect.arrayContaining([
        "--build-arg",
        "BASE_IMAGE=ghcr.io/vendor/api:1",
        "-t",
        "daoflow-owned:deployment_123"
      ])
    );
  });
});
