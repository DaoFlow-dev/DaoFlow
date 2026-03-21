import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ComposeBuildPlan } from "../compose-build-plan";

function createComposeWorkspace(buildPlan: ComposeBuildPlan) {
  return {
    workDir: "/tmp/daoflow-build",
    composeFile: ".daoflow.compose.rendered.yaml",
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
        composeFile: {
          path: ".daoflow.compose.rendered.yaml",
          sourcePath: "deploy/compose.yaml",
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
  readDeploymentComposeStateResult?: {
    envState: {
      kind: "queued";
      entries: [];
    };
  };
  swarmServiceStatuses?: Array<{
    id: string;
    name: string;
    mode: string;
    replicas: string;
    image: string;
    ports: string | null;
  }>;
  swarmTaskStatuses?: Array<{
    id: string;
    name: string;
    image: string;
    node: string | null;
    desiredState: string;
    currentState: string;
    error: string | null;
    ports: string | null;
  }>;
}) {
  const persistDeploymentComposeEnvState = vi.fn();
  const dockerComposePull = vi.fn().mockResolvedValue({ exitCode: 0 });
  const dockerComposeBuild = vi.fn().mockResolvedValue({ exitCode: 0 });
  const dockerComposeDown = vi.fn().mockResolvedValue({ exitCode: 0 });
  const dockerComposeUp = vi.fn().mockResolvedValue({ exitCode: 0 });
  const dockerComposePs = vi.fn().mockResolvedValue({
    exitCode: 0,
    statuses: input.composeStatuses ?? [
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
  const dockerStackDeploy = vi.fn().mockResolvedValue({ exitCode: 0 });
  const dockerStackRemove = vi.fn().mockResolvedValue({ exitCode: 0 });
  const dockerStackServices = vi.fn().mockResolvedValue({
    exitCode: 0,
    services: input.swarmServiceStatuses ?? [
      {
        id: "stack_api",
        name: "demo_api",
        mode: "replicated",
        replicas: "1/1",
        image: "ghcr.io/example/api:stable",
        ports: null
      }
    ]
  });
  const dockerStackPs = vi.fn().mockResolvedValue({
    exitCode: 0,
    tasks: input.swarmTaskStatuses ?? [
      {
        id: "task_api_1",
        name: "demo_api.1",
        image: "ghcr.io/example/api:stable",
        node: "manager-1",
        desiredState: "Running",
        currentState: "Running 3 seconds ago",
        error: null,
        ports: null
      }
    ]
  });

  vi.doMock("../db/connection", () => ({
    db: {
      update: vi.fn(() => ({
        set: vi.fn(() => ({
          where: vi.fn()
        }))
      }))
    }
  }));

  vi.doMock("../db/schema/deployments", () => ({
    deployments: {
      id: "id"
    }
  }));

  vi.doMock("../db/services/deployment-execution-control", () => ({
    throwIfDeploymentCancellationRequested: vi.fn().mockResolvedValue(undefined)
  }));

  vi.doMock("../compose-readiness", () => ({
    readComposeReadinessProbeSnapshot: vi.fn(() => null)
  }));

  vi.doMock("../db/services/compose-env", () => ({
    persistDeploymentComposeEnvState,
    readDeploymentComposeState: vi.fn(
      () =>
        input.readDeploymentComposeStateResult ?? {
          envState: {
            kind: "queued",
            entries: []
          }
        }
    )
  }));

  vi.doMock("./docker-executor", () => ({
    gitClone: vi.fn(),
    dockerBuild: vi.fn(),
    dockerComposeBuild,
    dockerComposeDown,
    dockerComposePs,
    dockerPull: vi.fn(),
    dockerComposePull,
    dockerComposeUp,
    dockerRun: vi.fn(),
    checkContainerHealth: vi.fn(),
    ensureStagingDir: vi.fn()
  }));

  vi.doMock("./swarm-executor", () => ({
    dockerStackDeploy,
    dockerStackRemove,
    dockerStackServices,
    dockerStackPs
  }));

  vi.doMock("./ssh-executor", () => ({
    remoteCheckContainerHealth: vi.fn(),
    remoteDockerBuild: vi.fn(),
    remoteDockerComposeBuild: vi.fn(),
    remoteDockerComposeDown: vi.fn(),
    remoteDockerComposePs: vi.fn(),
    remoteDockerComposePull: vi.fn(),
    remoteDockerComposeUp: vi.fn(),
    remoteDockerStackDeploy: vi.fn(),
    remoteDockerStackRemove: vi.fn(),
    remoteDockerStackServices: vi.fn(),
    remoteDockerStackPs: vi.fn(),
    remoteDockerPull: vi.fn(),
    remoteDockerRun: vi.fn(),
    remoteGitClone: vi.fn()
  }));

  vi.doMock("./compose-workspace", () => ({
    prepareComposeWorkspace: vi.fn(() => createComposeWorkspace(input.buildPlan))
  }));

  vi.doMock("./step-management", () => ({
    createStep: vi.fn().mockResolvedValue(1),
    markStepRunning: vi.fn(),
    markStepComplete: vi.fn(),
    markStepFailed: vi.fn(),
    transitionDeployment: vi.fn()
  }));

  const { executeComposeDeployment } = await import("./deploy-strategies");

  return {
    executeComposeDeployment,
    persistDeploymentComposeEnvState,
    dockerComposePull,
    dockerComposeBuild,
    dockerComposeDown,
    dockerComposeUp
  };
}

describe("executeComposeDeployment", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  it("builds compose services before start when the frozen workspace includes local build contexts", async () => {
    const {
      executeComposeDeployment,
      persistDeploymentComposeEnvState,
      dockerComposePull,
      dockerComposeBuild,
      dockerComposeUp
    } = await loadHarness({
      buildPlan: createBuildPlan({
        strategy: "build-only",
        services: [
          {
            serviceName: "api",
            context: "deploy",
            contextType: "local-path",
            image: null,
            dockerfile: "Dockerfile",
            target: null,
            args: [],
            additionalContexts: [],
            secrets: []
          }
        ],
        warnings: []
      })
    });

    await executeComposeDeployment(
      {
        id: "dep_build_compose",
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
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      undefined
    );
    expect(dockerComposeUp).toHaveBeenCalledWith(
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      undefined
    );
    expect(dockerComposeBuild.mock.invocationCallOrder[0]).toBeLessThan(
      dockerComposeUp.mock.invocationCallOrder[0]
    );
    expect(persistDeploymentComposeEnvState).toHaveBeenCalledTimes(1);
    const persistedState = persistDeploymentComposeEnvState.mock.calls[0]?.[0] as {
      deploymentId: string;
      composeBuildPlan?: {
        strategy?: string;
      };
    };
    expect(persistedState.deploymentId).toBe("dep_build_compose");
    expect(persistedState.composeBuildPlan?.strategy).toBe("build-only");
  });

  it("pulls remote images before building local compose services for mixed stacks", async () => {
    const { executeComposeDeployment, dockerComposePull, dockerComposeBuild, dockerComposeUp } =
      await loadHarness({
        buildPlan: createBuildPlan({
          strategy: "mixed",
          services: [
            {
              serviceName: "api",
              context: "deploy",
              contextType: "local-path",
              image: "ghcr.io/example/api:stable",
              dockerfile: "Dockerfile",
              target: null,
              args: [],
              additionalContexts: [],
              secrets: []
            }
          ],
          warnings: []
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
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      undefined
    );
    expect(dockerComposeBuild).toHaveBeenCalledWith(
      ".daoflow.compose.rendered.yaml",
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

  it("pulls only the scoped compose service when the selected service has no local build context", async () => {
    const { executeComposeDeployment, dockerComposePull, dockerComposeBuild, dockerComposeUp } =
      await loadHarness({
        composeStatuses: [
          {
            service: "worker",
            name: "demo-worker-1",
            state: "running",
            status: "Up 2 seconds (healthy)",
            health: "healthy",
            exitCode: 0
          }
        ],
        buildPlan: createBuildPlan({
          strategy: "mixed",
          services: [
            {
              serviceName: "api",
              context: "deploy",
              contextType: "local-path",
              image: "ghcr.io/example/api:stable",
              dockerfile: "Dockerfile",
              target: null,
              args: [],
              additionalContexts: [],
              secrets: []
            }
          ],
          warnings: []
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
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "worker"
    );
    expect(dockerComposeBuild).not.toHaveBeenCalled();
    expect(dockerComposeUp).toHaveBeenCalledWith(
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "worker"
    );
  });

  it("pulls scoped dependencies before building a selected service in mixed compose stacks", async () => {
    const { executeComposeDeployment, dockerComposePull, dockerComposeBuild, dockerComposeUp } =
      await loadHarness({
        buildPlan: createBuildPlan({
          strategy: "mixed",
          services: [
            {
              serviceName: "api",
              context: "deploy",
              contextType: "local-path",
              image: "ghcr.io/example/api:stable",
              dockerfile: "Dockerfile",
              target: null,
              args: [],
              additionalContexts: [],
              secrets: []
            }
          ],
          warnings: []
        })
      });

    await executeComposeDeployment(
      {
        id: "dep_scoped_mixed_build",
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
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "api"
    );
    expect(dockerComposeBuild).toHaveBeenCalledWith(
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "api"
    );
    expect(dockerComposePull.mock.invocationCallOrder[0]).toBeLessThan(
      dockerComposeBuild.mock.invocationCallOrder[0]
    );
    expect(dockerComposeBuild.mock.invocationCallOrder[0]).toBeLessThan(
      dockerComposeUp.mock.invocationCallOrder[0]
    );
  });

  it("uses the normalized dependency graph to build build-backed dependencies of a scoped service", async () => {
    const { executeComposeDeployment, dockerComposePull, dockerComposeBuild } = await loadHarness({
      composeStatuses: [
        {
          service: "api",
          name: "demo-api-1",
          state: "running",
          status: "Up 2 seconds (healthy)",
          health: "healthy",
          exitCode: 0
        },
        {
          service: "db",
          name: "demo-db-1",
          state: "running",
          status: "Up 2 seconds (healthy)",
          health: "healthy",
          exitCode: 0
        }
      ],
      buildPlan: createBuildPlan({
        stackName: "demo",
        strategy: "mixed",
        services: [
          {
            serviceName: "db",
            context: "deploy/db",
            contextType: "local-path",
            image: "ghcr.io/example/db:stable",
            dockerfile: "Dockerfile",
            target: null,
            args: [],
            additionalContexts: [],
            secrets: []
          }
        ],
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
        ],
        networks: [],
        volumes: [],
        secrets: [],
        configs: [],
        warnings: []
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
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "api"
    );
    expect(dockerComposeBuild).toHaveBeenCalledWith(
      ".daoflow.compose.rendered.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "api"
    );
  });

  it("runs docker compose down for preview cleanup deployments", async () => {
    const { executeComposeDeployment, dockerComposePull, dockerComposeBuild, dockerComposeDown } =
      await loadHarness({
        buildPlan: createBuildPlan({
          strategy: "pull-only",
          services: [],
          warnings: []
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
      ".daoflow.compose.rendered.yaml",
      "demo-pr-42",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env"
    );
  });
});
