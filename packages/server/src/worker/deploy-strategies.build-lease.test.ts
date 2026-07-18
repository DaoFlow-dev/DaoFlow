import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkContainerHealth: vi.fn(),
  dockerPull: vi.fn(),
  dockerRun: vi.fn(),
  listContainerRegistryCredentialsForProjectImageReferences: vi.fn(),
  markStepComplete: vi.fn(),
  markStepRunning: vi.fn(),
  createStep: vi.fn(),
  transitionDeployment: vi.fn(),
  throwIfDeploymentCancellationRequested: vi.fn(),
  withDeploymentBuildLease: vi.fn(),
  update: vi.fn()
}));

vi.mock("../db/connection", () => ({
  db: {
    update: mocks.update
  }
}));

vi.mock("../db/services/container-registry-credentials", () => ({
  listContainerRegistryCredentialsForProjectImageReferences:
    mocks.listContainerRegistryCredentialsForProjectImageReferences,
  listContainerRegistryCredentialsForProject: vi.fn()
}));

vi.mock("../db/services/deployment-execution-control", () => ({
  throwIfDeploymentCancellationRequested: mocks.throwIfDeploymentCancellationRequested
}));

vi.mock("./deployment-build-lease", () => ({
  withDeploymentBuildLease: mocks.withDeploymentBuildLease
}));

vi.mock("./docker-executor", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./docker-executor")>();
  return {
    ...actual,
    checkContainerHealth: mocks.checkContainerHealth,
    dockerPull: mocks.dockerPull,
    dockerRun: mocks.dockerRun
  };
});

vi.mock("./step-management", () => ({
  createStep: mocks.createStep,
  markStepComplete: mocks.markStepComplete,
  markStepRunning: mocks.markStepRunning,
  markStepFailed: vi.fn(),
  transitionDeployment: mocks.transitionDeployment
}));

describe("image deployment build lease integration", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.listContainerRegistryCredentialsForProjectImageReferences.mockResolvedValue([]);
    mocks.throwIfDeploymentCancellationRequested.mockResolvedValue(undefined);
    mocks.createStep.mockResolvedValue(1);
    mocks.markStepRunning.mockResolvedValue(undefined);
    mocks.markStepComplete.mockResolvedValue(undefined);
    mocks.transitionDeployment.mockResolvedValue(undefined);
    mocks.dockerPull.mockResolvedValue({ exitCode: 0 });
    mocks.dockerRun.mockResolvedValue({ exitCode: 0 });
    mocks.checkContainerHealth.mockResolvedValue(true);
    mocks.update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    });
  });

  it("does not request a build lease for an image-only deployment", async () => {
    const { executeImageDeployment } = await import("./deploy-strategies");

    await executeImageDeployment(
      {
        id: "dep_image_only",
        projectId: "project_image_only",
        serviceName: "api",
        imageTag: "ghcr.io/daoflow/api:test"
      } as never,
      {},
      "image-only-api",
      () => undefined,
      { mode: "local" }
    );

    expect(mocks.dockerPull).toHaveBeenCalledTimes(1);
    expect(mocks.dockerRun).toHaveBeenCalledTimes(1);
    expect(mocks.withDeploymentBuildLease).not.toHaveBeenCalled();
  });
});
