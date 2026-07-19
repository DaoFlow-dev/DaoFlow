import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  ensureDirectDockerVolumeOwnership: vi.fn(),
  dockerRun: vi.fn(),
  remoteDockerRun: vi.fn()
}));

vi.mock("./direct-volume-ownership", () => ({
  ensureDirectDockerVolumeOwnership: mocks.ensureDirectDockerVolumeOwnership
}));
vi.mock("./docker-executor", () => ({ dockerRun: mocks.dockerRun }));
vi.mock("./ssh-executor", () => ({ remoteDockerRun: mocks.remoteDockerRun }));

const ownership = {
  teamId: "team_123",
  projectId: "project_123",
  environmentId: "environment_123",
  serviceId: "service_123",
  deploymentId: "deployment_123"
};

describe("owned direct Docker run", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.ensureDirectDockerVolumeOwnership.mockResolvedValue(undefined);
    mocks.dockerRun.mockResolvedValue({ exitCode: 0 });
    mocks.remoteDockerRun.mockResolvedValue({ exitCode: 0 });
  });

  it("prepares volumes before local docker run and supplies container labels", async () => {
    const { runOwnedDockerContainer } = await import("./direct-docker-run");

    await runOwnedDockerContainer({
      tag: "daoflow/api:test",
      containerName: "api",
      config: { volumes: ["data:/data"], ports: ["8080:80"] },
      ownership,
      onLog: () => undefined,
      target: { mode: "local" }
    });

    expect(mocks.ensureDirectDockerVolumeOwnership).toHaveBeenCalledBefore(mocks.dockerRun);
    expect(mocks.dockerRun).toHaveBeenCalledWith(
      "daoflow/api:test",
      "api",
      expect.objectContaining({
        labels: expect.objectContaining({
          "io.daoflow.managed": "true",
          "io.daoflow.service-id": "service_123"
        })
      }),
      expect.any(Function),
      undefined
    );
  });

  it("passes the same ownership labels to remote docker run", async () => {
    const { runOwnedDockerContainer } = await import("./direct-docker-run");
    const target = {
      mode: "remote" as const,
      ssh: { serverName: "qa", host: "qa.example", port: 22 },
      remoteWorkDir: "/tmp/work"
    };

    await runOwnedDockerContainer({
      tag: "daoflow/api:test",
      containerName: "api",
      config: {},
      ownership,
      onLog: () => undefined,
      target
    });

    expect(mocks.remoteDockerRun).toHaveBeenCalledWith(
      target.ssh,
      "daoflow/api:test",
      "api",
      expect.objectContaining({
        labels: expect.objectContaining({ "io.daoflow.deployment-id": "deployment_123" })
      }),
      expect.any(Function),
      undefined
    );
  });
});
