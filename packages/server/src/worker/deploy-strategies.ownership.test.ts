import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  checkContainerHealth: vi.fn(),
  dockerBuild: vi.fn(),
  dockerBuildMetadataWrapper: vi.fn(),
  dockerPull: vi.fn(),
  execStreaming: vi.fn(),
  gitClone: vi.fn(),
  runOwnedDockerContainer: vi.fn(),
  createStep: vi.fn(),
  markStepRunning: vi.fn(),
  markStepComplete: vi.fn(),
  markStepFailed: vi.fn(),
  transitionDeployment: vi.fn(),
  throwIfDeploymentCancellationRequested: vi.fn(),
  withDeploymentBuildLease: vi.fn(),
  update: vi.fn()
}));

vi.mock("../db/connection", () => ({
  db: { update: mocks.update }
}));
vi.mock("../db/services/container-registry-credentials", () => ({
  listContainerRegistryCredentialsForProject: vi.fn().mockResolvedValue([]),
  listContainerRegistryCredentialsForProjectImageReferences: vi.fn().mockResolvedValue([])
}));
vi.mock("../db/services/deployment-execution-control", () => ({
  throwIfDeploymentCancellationRequested: mocks.throwIfDeploymentCancellationRequested
}));
vi.mock("./checkout-source", () => ({
  resolveCheckoutSpec: vi.fn(() => ({
    repoUrl: "https://example.com/org/repo.git",
    branch: "main",
    displayLabel: "org/repo",
    gitConfig: [],
    caCertificatePem: "-----BEGIN CERTIFICATE-----\nfixture-ca\n-----END CERTIFICATE-----",
    repositoryPreparation: { submodules: false, gitLfs: false }
  }))
}));
vi.mock("./deployment-build-lease", () => ({
  withDeploymentBuildLease: mocks.withDeploymentBuildLease
}));
vi.mock("./direct-docker-run", () => ({
  runOwnedDockerContainer: mocks.runOwnedDockerContainer
}));
vi.mock("./docker-executor", () => ({
  checkContainerHealth: mocks.checkContainerHealth,
  createTarArchive: vi.fn(),
  dockerBuild: mocks.dockerBuild,
  dockerBuildMetadataWrapper: mocks.dockerBuildMetadataWrapper,
  dockerPull: mocks.dockerPull,
  execStreaming: mocks.execStreaming,
  getStagingArchivePath: vi.fn(),
  gitClone: mocks.gitClone,
  STAGING_DIR: "/tmp/daoflow-staging"
}));
vi.mock("./ssh-executor", () => ({
  remoteCheckContainerHealth: vi.fn(),
  remoteDockerBuild: vi.fn(),
  remoteDockerBuildMetadataWrapper: vi.fn(),
  remoteDockerPull: vi.fn(),
  remoteDockerRun: vi.fn(),
  remoteEnsureDir: vi.fn(),
  remoteExtractArchive: vi.fn(),
  scpUpload: vi.fn()
}));
vi.mock("./step-management", () => ({
  createStep: mocks.createStep,
  markStepComplete: mocks.markStepComplete,
  markStepFailed: mocks.markStepFailed,
  markStepRunning: mocks.markStepRunning,
  transitionDeployment: mocks.transitionDeployment
}));

const ownership = {
  teamId: "team_123",
  projectId: "project_123",
  environmentId: "environment_123",
  serviceId: "service_123",
  deploymentId: "deployment_123"
};
const target = { mode: "local" as const };
const deployment = {
  id: "deployment_123",
  projectId: "project_123",
  targetServerId: "server_123",
  serviceName: "api",
  imageTag: "ghcr.io/vendor/api:1",
  commitSha: "abcdef"
};

describe("direct deployment ownership propagation", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.checkContainerHealth.mockResolvedValue(true);
    mocks.dockerBuild.mockResolvedValue({ exitCode: 0 });
    mocks.dockerBuildMetadataWrapper.mockResolvedValue({ exitCode: 0 });
    mocks.dockerPull.mockResolvedValue({ exitCode: 0 });
    mocks.execStreaming.mockResolvedValue({ exitCode: 0 });
    mocks.gitClone.mockResolvedValue({ exitCode: 0, workDir: "/tmp/work" });
    mocks.runOwnedDockerContainer.mockResolvedValue({ exitCode: 0 });
    mocks.createStep.mockResolvedValue(1);
    mocks.markStepRunning.mockResolvedValue(undefined);
    mocks.markStepComplete.mockResolvedValue(undefined);
    mocks.markStepFailed.mockResolvedValue(undefined);
    mocks.transitionDeployment.mockResolvedValue(undefined);
    mocks.throwIfDeploymentCancellationRequested.mockResolvedValue(undefined);
    mocks.withDeploymentBuildLease.mockImplementation((input: { run: () => Promise<unknown> }) =>
      input.run()
    );
    mocks.update.mockReturnValue({
      set: vi.fn().mockReturnValue({ where: vi.fn().mockResolvedValue(undefined) })
    });
  });

  it("passes the typed identity through Dockerfile, image, Nixpacks, and buildpack execution", async () => {
    const {
      executeBuildpackDeployment,
      executeDockerfileDeployment,
      executeImageDeployment,
      executeNixpacksDeployment
    } = await import("./deploy-strategies");
    const onLog = () => undefined;

    await executeDockerfileDeployment(deployment as never, {}, "api", ownership, onLog, target);
    await executeImageDeployment(deployment as never, {}, "api", ownership, onLog, target);
    await executeNixpacksDeployment(deployment as never, {}, "api", ownership, onLog, target);
    await executeBuildpackDeployment(deployment as never, {}, "api", ownership, onLog, target);

    expect(mocks.dockerBuild).toHaveBeenCalledWith(
      "/tmp/work/.",
      "/tmp/work/Dockerfile",
      "ghcr.io/vendor/api:1",
      expect.objectContaining({ "io.daoflow.service-id": "service_123" }),
      onLog,
      [],
      undefined
    );
    expect(mocks.dockerBuildMetadataWrapper).toHaveBeenCalledWith(
      "ghcr.io/vendor/api:1",
      "daoflow-owned:deployment_123",
      expect.objectContaining({ "io.daoflow.deployment-id": "deployment_123" }),
      onLog,
      undefined
    );
    const expectedCa = "-----BEGIN CERTIFICATE-----\nfixture-ca\n-----END CERTIFICATE-----";
    expect(mocks.gitClone).toHaveBeenNthCalledWith(
      1,
      "https://example.com/org/repo.git",
      "main",
      "deployment_123",
      onLog,
      expect.objectContaining({ caCertificatePem: expectedCa })
    );
    expect(mocks.gitClone).toHaveBeenNthCalledWith(
      2,
      "https://example.com/org/repo.git",
      "main",
      "deployment_123",
      onLog,
      expect.objectContaining({ caCertificatePem: expectedCa })
    );
    expect(mocks.gitClone).toHaveBeenNthCalledWith(
      3,
      "https://example.com/org/repo.git",
      "main",
      "deployment_123",
      onLog,
      expect.objectContaining({ caCertificatePem: expectedCa })
    );
    expect(mocks.execStreaming).toHaveBeenCalledWith(
      "nixpacks",
      expect.arrayContaining(["--label", "io.daoflow.team-id=team_123"]),
      "/tmp/daoflow-staging",
      onLog,
      undefined,
      expect.any(Object)
    );
    expect(mocks.execStreaming).toHaveBeenCalledWith(
      "pack",
      expect.arrayContaining(["build", "daoflow/api:abcdef"]),
      "/tmp/daoflow-staging",
      onLog,
      undefined,
      expect.any(Object)
    );
    expect(mocks.dockerBuildMetadataWrapper).toHaveBeenCalledWith(
      "daoflow/api:abcdef",
      "daoflow/api:abcdef",
      expect.objectContaining({ "io.daoflow.managed": "true" }),
      onLog,
      undefined
    );
    expect(mocks.runOwnedDockerContainer).toHaveBeenCalledTimes(4);
    for (const call of mocks.runOwnedDockerContainer.mock.calls) {
      expect(call[0]).toMatchObject({ ownership });
    }
  });
});
