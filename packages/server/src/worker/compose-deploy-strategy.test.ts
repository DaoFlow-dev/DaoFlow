import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposeBuildPlan } from "../compose-build-plan";

function createLocalBuildService(
  serviceName: string,
  image: string | null = null,
  context = "deploy"
) {
  return {
    serviceName,
    context,
    contextType: "local-path" as const,
    image,
    dockerfile: "Dockerfile",
    target: null,
    args: [],
    additionalContexts: [],
    secrets: []
  };
}

function createHealthyStatus(service: string) {
  return {
    service,
    name: `demo-${service}-1`,
    state: "running",
    status: "Up 2 seconds (healthy)",
    health: "healthy" as const,
    exitCode: 0
  };
}

function createComposeWorkspace(buildPlan: ComposeBuildPlan) {
  return {
    workDir: "/tmp/daoflow-build",
    composeFile: ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
    composeFiles: [".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml"],
    composeBuildPlan: buildPlan,
    composeEnv: {
      composeEnv: {
        status: "materialized" as const,
        branch: "main",
        fileName: ".daoflow.compose.env",
        precedence: ["repo-defaults", "environment-variables"],
        counts: {
          total: 0,
          repoDefaults: 0,
          environmentVariables: 0,
          runtime: 0,
          build: 0,
          secrets: 0,
          overriddenRepoDefaults: 0
        },
        warnings: [],
        entries: []
      },
      payloadEntries: []
    },
    composeInputs: {
      manifest: {
        status: "materialized" as const,
        version: 1 as const,
        warnings: [],
        entries: []
      },
      frozenInputs: {
        composeFiles: [
          {
            path: ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
            sourcePath: "deploy/compose.yaml",
            contents: "services:\n  api:\n    build: .\n"
          }
        ],
        composeFile: {
          path: ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
          sourcePath: "deploy/compose.yaml",
          contents: "services:\n  api:\n    build: .\n"
        },
        renderedCompose: {
          path: ".daoflow.compose.rendered.yaml",
          contents: "services:\n  api:\n    build: .\n"
        },
        envFiles: []
      }
    }
  };
}

function createBuildPlan(input: {
  stackName?: string | null;
  strategy: ComposeBuildPlan["strategy"];
  services: ComposeBuildPlan["services"];
  graphServices?: ComposeBuildPlan["graphServices"];
  networks?: ComposeBuildPlan["networks"];
  volumes?: ComposeBuildPlan["volumes"];
  secrets?: ComposeBuildPlan["secrets"];
  configs?: ComposeBuildPlan["configs"];
  warnings?: string[];
}): ComposeBuildPlan {
  return {
    status: "materialized",
    version: 1,
    stackName: input.stackName ?? null,
    strategy: input.strategy,
    services: input.services,
    graphServices: input.graphServices ?? [],
    networks: input.networks ?? [],
    volumes: input.volumes ?? [],
    secrets: input.secrets ?? [],
    configs: input.configs ?? [],
    warnings: input.warnings ?? []
  };
}

async function loadHarness(input: {
  buildPlan: ComposeBuildPlan;
  composeStatuses?: Array<{
    service: string;
    name: string;
    state: string;
    status: string;
    health: string | null;
    exitCode: number | null;
  }>;
}) {
  const persistDeploymentComposeEnvState = vi.fn();
  const dockerComposePull = vi.fn().mockResolvedValue({ exitCode: 0 });
  const dockerComposeBuild = vi.fn().mockResolvedValue({ exitCode: 0 });
  const dockerComposeDown = vi.fn().mockResolvedValue({ exitCode: 0 });
  const dockerComposeUp = vi.fn().mockResolvedValue({ exitCode: 0 });
  const dockerComposePs = vi.fn().mockResolvedValue({
    exitCode: 0,
    statuses: input.composeStatuses ?? [createHealthyStatus("api")]
  });

  vi.doMock("../db/services/compose-env", () => ({
    persistDeploymentComposeEnvState,
    readDeploymentComposeState: vi.fn(() => ({
      envState: {
        kind: "queued",
        entries: []
      }
    }))
  }));

  vi.doMock("../compose-readiness", () => ({
    readComposeReadinessProbeSnapshot: vi.fn(() => null)
  }));

  vi.doMock("./compose-workspace", () => ({
    prepareComposeWorkspace: vi.fn(() => createComposeWorkspace(input.buildPlan))
  }));

  vi.doMock("./docker-executor", () => ({
    dockerComposeBuild,
    dockerComposeDown,
    dockerComposePs,
    dockerComposePull,
    dockerComposeUp
  }));

  vi.doMock("./ssh-executor", () => ({
    remoteDockerComposeBuild: vi.fn(),
    remoteDockerComposeDown: vi.fn(),
    remoteDockerComposePs: vi.fn(),
    remoteDockerComposePull: vi.fn(),
    remoteDockerComposeUp: vi.fn()
  }));

  vi.doMock("./step-management", () => ({
    createStep: vi.fn().mockResolvedValue(1),
    markStepRunning: vi.fn(),
    markStepComplete: vi.fn(),
    markStepFailed: vi.fn(),
    transitionDeployment: vi.fn()
  }));

  const { executeComposeDeployment } = await import("./compose-deploy-strategy");

  return {
    executeComposeDeployment,
    persistDeploymentComposeEnvState,
    dockerComposeBuild,
    dockerComposeDown,
    dockerComposePs,
    dockerComposePull,
    dockerComposeUp
  };
}

describe("executeComposeDeployment", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("builds local compose services before start without pulling a build-only stack", async () => {
    const {
      executeComposeDeployment,
      persistDeploymentComposeEnvState,
      dockerComposePull,
      dockerComposeBuild,
      dockerComposeUp
    } = await loadHarness({
      buildPlan: createBuildPlan({
        strategy: "build-only",
        services: [createLocalBuildService("api")]
      })
    });

    await executeComposeDeployment(
      {
        id: "dep_build_only",
        serviceName: "api",
        envVarsEncrypted: null
      } as never,
      {
        deploymentSource: "git-repository",
        composeFilePath: "deploy/compose.yaml"
      },
      "demo",
      () => undefined,
      { mode: "local" }
    );

    expect(dockerComposePull).not.toHaveBeenCalled();
    expect(dockerComposeBuild).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      undefined
    );
    expect(dockerComposeUp).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      undefined
    );
    expect(dockerComposeBuild.mock.invocationCallOrder[0]).toBeLessThan(
      dockerComposeUp.mock.invocationCallOrder[0]
    );

    const persistedState = persistDeploymentComposeEnvState.mock.calls[0]?.[0] as {
      deploymentId: string;
      composeBuildPlan?: {
        strategy?: string;
      };
    };
    expect(persistedState.deploymentId).toBe("dep_build_only");
    expect(persistedState.composeBuildPlan?.strategy).toBe("build-only");
  });

  it("pulls then builds before start for mixed compose stacks", async () => {
    const { executeComposeDeployment, dockerComposePull, dockerComposeBuild, dockerComposeUp } =
      await loadHarness({
        buildPlan: createBuildPlan({
          strategy: "mixed",
          services: [createLocalBuildService("api", "ghcr.io/example/api:stable")]
        })
      });

    await executeComposeDeployment(
      {
        id: "dep_mixed_compose",
        serviceName: "api",
        envVarsEncrypted: null
      } as never,
      {
        deploymentSource: "git-repository",
        composeFilePath: "deploy/compose.yaml"
      },
      "demo",
      () => undefined,
      { mode: "local" }
    );

    expect(dockerComposePull).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      undefined
    );
    expect(dockerComposeBuild).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      undefined
    );
    expect(dockerComposePull.mock.invocationCallOrder[0]).toBeLessThan(
      dockerComposeBuild.mock.invocationCallOrder[0]
    );
    expect(dockerComposeBuild.mock.invocationCallOrder[0]).toBeLessThan(
      dockerComposeUp.mock.invocationCallOrder[0]
    );
  });

  it("pulls only the scoped service when the selected service has no build context", async () => {
    const { executeComposeDeployment, dockerComposePull, dockerComposeBuild, dockerComposeUp } =
      await loadHarness({
        composeStatuses: [createHealthyStatus("worker")],
        buildPlan: createBuildPlan({
          strategy: "mixed",
          services: [createLocalBuildService("api", "ghcr.io/example/api:stable")]
        })
      });

    await executeComposeDeployment(
      {
        id: "dep_scoped_pull_only",
        serviceName: "worker",
        envVarsEncrypted: null
      } as never,
      {
        deploymentSource: "git-repository",
        composeFilePath: "deploy/compose.yaml",
        composeServiceName: "worker"
      },
      "demo",
      () => undefined,
      { mode: "local" }
    );

    expect(dockerComposePull).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "worker"
    );
    expect(dockerComposeBuild).not.toHaveBeenCalled();
    expect(dockerComposeUp).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "worker"
    );
  });

  it("checks health for the full dependency closure when a scoped service depends on build-backed services", async () => {
    const { executeComposeDeployment, dockerComposePull, dockerComposeBuild, dockerComposePs } =
      await loadHarness({
        composeStatuses: [createHealthyStatus("api"), createHealthyStatus("db")],
        buildPlan: createBuildPlan({
          stackName: "demo",
          strategy: "mixed",
          services: [createLocalBuildService("db", "ghcr.io/example/db:stable", "deploy/db")],
          graphServices: [
            {
              serviceName: "api",
              image: "ghcr.io/example/api:stable",
              hasBuild: false,
              dependsOn: [
                {
                  serviceName: "db",
                  condition: "service_healthy",
                  required: true,
                  restart: false
                }
              ],
              healthcheck: {
                present: true,
                disabled: false,
                testType: "command",
                interval: null,
                timeout: null,
                startPeriod: null,
                startInterval: null,
                retries: null
              },
              networks: [],
              namedVolumes: [],
              runtimeSecrets: [],
              configs: [],
              profiles: []
            },
            {
              serviceName: "db",
              image: "ghcr.io/example/db:stable",
              hasBuild: true,
              dependsOn: [],
              healthcheck: {
                present: true,
                disabled: false,
                testType: "command",
                interval: null,
                timeout: null,
                startPeriod: null,
                startInterval: null,
                retries: null
              },
              networks: [],
              namedVolumes: [],
              runtimeSecrets: [],
              configs: [],
              profiles: []
            }
          ]
        })
      });

    await executeComposeDeployment(
      {
        id: "dep_graph_dependency_build",
        serviceName: "api",
        envVarsEncrypted: null
      } as never,
      {
        deploymentSource: "git-repository",
        composeFilePath: "deploy/compose.yaml",
        composeServiceName: "api"
      },
      "demo",
      () => undefined,
      { mode: "local" }
    );

    expect(dockerComposePull).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "api"
    );
    expect(dockerComposeBuild).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "api"
    );
    expect(dockerComposePs).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      undefined
    );
  });

  it("runs docker compose down for preview cleanup deployments", async () => {
    const { executeComposeDeployment, dockerComposePull, dockerComposeBuild, dockerComposeDown } =
      await loadHarness({
        buildPlan: createBuildPlan({
          strategy: "pull-only",
          services: []
        })
      });

    await executeComposeDeployment(
      {
        id: "dep_preview_cleanup",
        serviceName: "api",
        envVarsEncrypted: null
      } as never,
      {
        deploymentSource: "git-repository",
        composeFilePath: "deploy/compose.yaml",
        composeOperation: "down"
      },
      "demo-pr-42",
      () => undefined,
      { mode: "local" }
    );

    expect(dockerComposePull).not.toHaveBeenCalled();
    expect(dockerComposeBuild).not.toHaveBeenCalled();
    expect(dockerComposeDown).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo-pr-42",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env"
    );
  });
});
