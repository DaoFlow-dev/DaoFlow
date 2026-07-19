import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  inspectDockerVolume: vi.fn(),
  createDockerVolume: vi.fn(),
  inspectRemoteDockerVolume: vi.fn(),
  createRemoteDockerVolume: vi.fn()
}));

vi.mock("./docker-executor", () => ({
  inspectDockerVolume: mocks.inspectDockerVolume,
  createDockerVolume: mocks.createDockerVolume
}));
vi.mock("./ssh-executor", () => ({
  inspectRemoteDockerVolume: mocks.inspectRemoteDockerVolume,
  createRemoteDockerVolume: mocks.createRemoteDockerVolume
}));

const ownership = {
  teamId: "team_123",
  projectId: "project_123",
  environmentId: "environment_123",
  serviceId: "service_123",
  deploymentId: "deployment_123"
};

const matchingLabels = {
  "io.daoflow.managed": "true",
  "io.daoflow.team-id": "team_123",
  "io.daoflow.project-id": "project_123",
  "io.daoflow.environment-id": "environment_123",
  "io.daoflow.service-id": "service_123",
  "io.daoflow.deployment-id": "deployment_123"
};

describe("direct Docker volume ownership", () => {
  beforeEach(() => {
    vi.resetAllMocks();
    mocks.inspectDockerVolume.mockResolvedValue({ exists: false, labels: {} });
    mocks.createDockerVolume.mockResolvedValue({ exitCode: 0 });
    mocks.inspectRemoteDockerVolume.mockResolvedValue({ exists: false, labels: {} });
    mocks.createRemoteDockerVolume.mockResolvedValue({ exitCode: 0 });
  });

  it("identifies named volumes while leaving bind mounts alone and rejecting anonymous mounts", async () => {
    const { collectNamedDirectDockerVolumes } = await import("./direct-volume-ownership");

    expect(
      collectNamedDirectDockerVolumes(["data:/var/lib/data", "./cache:/cache", "/srv/logs:/logs"])
    ).toEqual(["data"]);
    expect(() => collectNamedDirectDockerVolumes(["/var/lib/data"])).toThrow("anonymous");
    expect(() => collectNamedDirectDockerVolumes([":/var/lib/data"])).toThrow("anonymous");
  });

  it("creates missing named volumes with the complete ownership labels", async () => {
    const { ensureDirectDockerVolumeOwnership } = await import("./direct-volume-ownership");
    mocks.inspectDockerVolume
      .mockResolvedValueOnce({ exists: false, labels: {} })
      .mockResolvedValueOnce({ exists: true, labels: matchingLabels });

    await ensureDirectDockerVolumeOwnership({
      target: { mode: "local" },
      declarations: ["data:/var/lib/data"],
      ownership,
      onLog: () => undefined
    });

    expect(mocks.createDockerVolume).toHaveBeenCalledWith(
      "data",
      expect.objectContaining({
        "io.daoflow.managed": "true",
        "io.daoflow.deployment-id": "deployment_123"
      }),
      expect.any(Function),
      undefined
    );
    expect(mocks.inspectDockerVolume).toHaveBeenCalledTimes(2);
  });

  it("fails closed when a created volume is missing on re-inspection", async () => {
    const { ensureDirectDockerVolumeOwnership } = await import("./direct-volume-ownership");
    mocks.inspectDockerVolume
      .mockResolvedValueOnce({ exists: false, labels: {} })
      .mockResolvedValueOnce({ exists: false, labels: {} });

    await expect(
      ensureDirectDockerVolumeOwnership({
        target: { mode: "local" },
        declarations: ["data:/var/lib/data"],
        ownership,
        onLog: () => undefined
      })
    ).rejects.toThrow("was not found after successful creation");
  });

  it("fails closed when a created volume is unlabeled on re-inspection", async () => {
    const { ensureDirectDockerVolumeOwnership } = await import("./direct-volume-ownership");
    mocks.inspectDockerVolume
      .mockResolvedValueOnce({ exists: false, labels: {} })
      .mockResolvedValueOnce({ exists: true, labels: {} });

    await expect(
      ensureDirectDockerVolumeOwnership({
        target: { mode: "local" },
        declarations: ["data:/var/lib/data"],
        ownership,
        onLog: () => undefined
      })
    ).rejects.toThrow("was created without DaoFlow ownership labels");
  });

  it("fails closed when a created volume has mismatched ownership on re-inspection", async () => {
    const { ensureDirectDockerVolumeOwnership } = await import("./direct-volume-ownership");
    mocks.inspectDockerVolume
      .mockResolvedValueOnce({ exists: false, labels: {} })
      .mockResolvedValueOnce({
        exists: true,
        labels: { ...matchingLabels, "io.daoflow.service-id": "other_service" }
      });

    await expect(
      ensureDirectDockerVolumeOwnership({
        target: { mode: "local" },
        declarations: ["data:/var/lib/data"],
        ownership,
        onLog: () => undefined
      })
    ).rejects.toThrow("another DaoFlow deployment scope");
  });

  it("re-inspects remote volumes after create and accepts matching ownership", async () => {
    const { ensureDirectDockerVolumeOwnership } = await import("./direct-volume-ownership");
    const target = {
      mode: "remote" as const,
      ssh: { serverName: "qa", host: "qa.example", port: 22 },
      remoteWorkDir: "/tmp/work"
    };
    mocks.inspectRemoteDockerVolume
      .mockResolvedValueOnce({ exists: false, labels: {} })
      .mockResolvedValueOnce({ exists: true, labels: matchingLabels });

    await ensureDirectDockerVolumeOwnership({
      target,
      declarations: ["data:/var/lib/data"],
      ownership,
      onLog: () => undefined
    });

    expect(mocks.createRemoteDockerVolume).toHaveBeenCalledWith(
      target.ssh,
      "data",
      expect.objectContaining({ "io.daoflow.deployment-id": "deployment_123" }),
      expect.any(Function),
      undefined
    );
    expect(mocks.inspectRemoteDockerVolume).toHaveBeenCalledTimes(2);
  });

  it("does not adopt existing unlabeled volumes and accepts the same scope from an older deployment", async () => {
    const { ensureDirectDockerVolumeOwnership } = await import("./direct-volume-ownership");
    mocks.inspectDockerVolume.mockResolvedValueOnce({ exists: true, labels: {} });
    const onLog = vi.fn();

    await ensureDirectDockerVolumeOwnership({
      target: { mode: "local" },
      declarations: ["foreign:/data"],
      ownership,
      onLog
    });
    expect(mocks.createDockerVolume).not.toHaveBeenCalled();
    expect(onLog).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining("will not adopt or delete it") })
    );

    mocks.inspectDockerVolume.mockResolvedValueOnce({
      exists: true,
      labels: {
        "io.daoflow.managed": "true",
        "io.daoflow.team-id": "team_123",
        "io.daoflow.project-id": "project_123",
        "io.daoflow.environment-id": "environment_123",
        "io.daoflow.service-id": "service_123",
        "io.daoflow.deployment-id": "deployment_old"
      }
    });
    await expect(
      ensureDirectDockerVolumeOwnership({
        target: { mode: "local" },
        declarations: ["owned:/data"],
        ownership,
        onLog: () => undefined
      })
    ).resolves.toBeUndefined();
  });

  it("rejects an existing DaoFlow volume from a different service scope", async () => {
    const { ensureDirectDockerVolumeOwnership } = await import("./direct-volume-ownership");
    mocks.inspectDockerVolume.mockResolvedValueOnce({
      exists: true,
      labels: {
        "io.daoflow.managed": "true",
        "io.daoflow.team-id": "team_123",
        "io.daoflow.project-id": "project_123",
        "io.daoflow.environment-id": "environment_123",
        "io.daoflow.service-id": "other_service",
        "io.daoflow.deployment-id": "deployment_old"
      }
    });

    await expect(
      ensureDirectDockerVolumeOwnership({
        target: { mode: "local" },
        declarations: ["owned:/data"],
        ownership,
        onLog: () => undefined
      })
    ).rejects.toThrow("another DaoFlow deployment scope");
  });
});
