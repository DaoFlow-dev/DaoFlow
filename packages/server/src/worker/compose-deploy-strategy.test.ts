import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearComposeDeployStrategyHarness,
  createBuildPlan,
  createHealthyStatus,
  createLocalBuildService,
  loadHarness,
  resetComposeDeployStrategyHarness
} from "./compose-deploy-strategy.test-support";

const ownership = {
  teamId: "team_test",
  projectId: "project_test",
  environmentId: "environment_test",
  serviceId: "service_test",
  deploymentId: "deployment_test"
};

describe("executeComposeDeployment", () => {
  beforeEach(() => {
    resetComposeDeployStrategyHarness();
  });

  afterEach(() => {
    clearComposeDeployStrategyHarness();
  });

  it("builds local compose services before start without pulling a build-only stack", async () => {
    const {
      executeComposeDeployment,
      persistDeploymentComposeEnvState,
      assertComposeRuntimeOwnership,
      dockerComposePull,
      dockerComposeBuild,
      dockerComposeUp,
      withDeploymentBuildLease
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
        targetServerId: "srv_build_only",
        envVarsEncrypted: null
      } as never,
      {
        deploymentSource: "git-repository",
        composeFilePath: "deploy/compose.yaml"
      },
      "demo",
      ownership,
      () => undefined,
      { mode: "local" }
    );

    expect(dockerComposePull).not.toHaveBeenCalled();
    expect(assertComposeRuntimeOwnership).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "compose",
        runtimeName: "demo",
        ownershipScopes: [ownership],
        target: { mode: "local" }
      })
    );
    expect(dockerComposeBuild).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      undefined,
      []
    );
    expect(dockerComposeUp).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      undefined,
      []
    );
    expect(dockerComposeBuild.mock.invocationCallOrder[0]).toBeLessThan(
      dockerComposeUp.mock.invocationCallOrder[0]
    );
    const leaseInput = (
      withDeploymentBuildLease.mock.calls as unknown as Array<
        [{ deploymentId: string; serverId: string; run: unknown }]
      >
    )[0]?.[0];
    expect(leaseInput).toMatchObject({
      deploymentId: "dep_build_only",
      serverId: "srv_build_only"
    });
    expect(leaseInput?.run).toEqual(expect.any(Function));

    const persistedState = persistDeploymentComposeEnvState.mock.calls[0]?.[0] as {
      deploymentId: string;
      composeBuildPlan?: {
        strategy?: string;
      };
    };
    expect(persistedState.deploymentId).toBe("dep_build_only");
    expect(persistedState.composeBuildPlan?.strategy).toBe("build-only");
  });

  it("stops before compose commands when runtime ownership preflight rejects a collision", async () => {
    const {
      executeComposeDeployment,
      assertComposeRuntimeOwnership,
      dockerComposeBuild,
      dockerComposePull,
      dockerComposeUp
    } = await loadHarness({
      buildPlan: createBuildPlan({
        strategy: "build-only",
        services: [createLocalBuildService("api")]
      })
    });
    assertComposeRuntimeOwnership.mockRejectedValueOnce(
      new Error(
        'Compose project "demo" has an unowned container (external-api); refusing to modify it.'
      )
    );

    await expect(
      executeComposeDeployment(
        {
          id: "dep_ownership_collision",
          serviceName: "api",
          envVarsEncrypted: null
        } as never,
        {
          deploymentSource: "git-repository",
          composeFilePath: "deploy/compose.yaml"
        },
        "demo",
        ownership,
        () => undefined,
        { mode: "local" }
      )
    ).rejects.toThrow('Compose project "demo" has an unowned container');

    expect(dockerComposePull).not.toHaveBeenCalled();
    expect(dockerComposeBuild).not.toHaveBeenCalled();
    expect(dockerComposeUp).not.toHaveBeenCalled();
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
      ownership,
      () => undefined,
      { mode: "local" }
    );

    expect(dockerComposePull).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      undefined,
      []
    );
    expect(dockerComposeBuild).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      undefined,
      []
    );
    expect(dockerComposePull.mock.invocationCallOrder[0]).toBeLessThan(
      dockerComposeBuild.mock.invocationCallOrder[0]
    );
    expect(dockerComposeBuild.mock.invocationCallOrder[0]).toBeLessThan(
      dockerComposeUp.mock.invocationCallOrder[0]
    );
  });

  it("pulls only the scoped service when the selected service has no build context", async () => {
    const {
      executeComposeDeployment,
      dockerComposePull,
      dockerComposeBuild,
      dockerComposeUp,
      withDeploymentBuildLease
    } = await loadHarness({
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
      ownership,
      () => undefined,
      { mode: "local" }
    );

    expect(dockerComposePull).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "worker",
      []
    );
    expect(dockerComposeBuild).not.toHaveBeenCalled();
    expect(withDeploymentBuildLease).not.toHaveBeenCalled();
    expect(dockerComposeUp).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "worker",
      []
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
      ownership,
      () => undefined,
      { mode: "local" }
    );

    expect(dockerComposePull).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "api",
      []
    );
    expect(dockerComposeBuild).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      "api",
      []
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

  it("removes only the verified Compose resources for preview cleanup", async () => {
    const {
      executeComposeDeployment,
      assertComposeRuntimeOwnership,
      cleanupComposeProjectRuntime,
      dockerComposePull,
      dockerComposeBuild,
      dockerComposeDown
    } = await loadHarness({
      buildPlan: createBuildPlan({
        strategy: "pull-only",
        services: []
      })
    });
    const verifiedResources = {
      containers: ["container-verified"],
      networks: ["network-verified"],
      volumes: ["volume-verified"],
      services: [],
      configs: [],
      secrets: []
    };
    assertComposeRuntimeOwnership.mockResolvedValueOnce(verifiedResources);

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
      ownership,
      () => undefined,
      { mode: "local" }
    );

    expect(dockerComposePull).not.toHaveBeenCalled();
    expect(dockerComposeBuild).not.toHaveBeenCalled();
    expect(dockerComposeDown).not.toHaveBeenCalled();
    expect(cleanupComposeProjectRuntime).toHaveBeenCalledWith(
      { mode: "local" },
      "demo-pr-42",
      [ownership],
      expect.any(Function),
      expect.any(Function),
      verifiedResources
    );
  });

  it("deploys Swarm manager targets with docker stack deploy semantics", async () => {
    const {
      executeComposeDeployment,
      assertComposeRuntimeOwnership,
      dockerComposeUp,
      dockerStackDeploy,
      dockerStackServices,
      dockerStackPs
    } = await loadHarness({
      buildPlan: createBuildPlan({
        strategy: "pull-only",
        services: []
      })
    });

    await executeComposeDeployment(
      {
        id: "dep_swarm_stack",
        serviceName: "api",
        envVarsEncrypted: null
      } as never,
      {
        deploymentSource: "git-repository",
        composeFilePath: "deploy/compose.yaml"
      },
      "demo-stack",
      ownership,
      () => undefined,
      { mode: "local", serverKind: "docker-swarm-manager" }
    );

    expect(dockerComposeUp).not.toHaveBeenCalled();
    expect(assertComposeRuntimeOwnership).toHaveBeenCalledWith(
      expect.objectContaining({
        kind: "swarm",
        runtimeName: "demo-stack",
        ownershipScopes: [ownership],
        target: { mode: "local", serverKind: "docker-swarm-manager" }
      })
    );
    expect(dockerStackDeploy).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo-stack",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env",
      []
    );
    expect(dockerStackServices).toHaveBeenCalledWith(
      "demo-stack",
      "/tmp/daoflow-build",
      expect.any(Function)
    );
    expect(dockerStackPs).toHaveBeenCalledWith(
      "demo-stack",
      "/tmp/daoflow-build",
      expect.any(Function)
    );
  });

  it("removes only verified preview stack resources on Swarm manager targets", async () => {
    const {
      executeComposeDeployment,
      assertComposeRuntimeOwnership,
      cleanupSwarmStackRuntime,
      dockerComposeDown,
      dockerStackRemove
    } = await loadHarness({
      buildPlan: createBuildPlan({
        strategy: "pull-only",
        services: []
      })
    });
    const verifiedResources = {
      containers: [],
      networks: ["network-verified"],
      volumes: [],
      services: ["service-verified"],
      configs: ["config-verified"],
      secrets: ["secret-verified"]
    };
    assertComposeRuntimeOwnership.mockResolvedValueOnce(verifiedResources);

    await executeComposeDeployment(
      {
        id: "dep_swarm_cleanup",
        serviceName: "api",
        envVarsEncrypted: null
      } as never,
      {
        deploymentSource: "git-repository",
        composeFilePath: "deploy/compose.yaml",
        composeOperation: "down"
      },
      "demo-stack-pr-42",
      ownership,
      () => undefined,
      { mode: "local", serverKind: "docker-swarm-manager" }
    );

    expect(dockerComposeDown).not.toHaveBeenCalled();
    expect(dockerStackRemove).not.toHaveBeenCalled();
    expect(cleanupSwarmStackRuntime).toHaveBeenCalledWith(
      { mode: "local", serverKind: "docker-swarm-manager" },
      "demo-stack-pr-42",
      [ownership],
      expect.any(Function),
      expect.any(Function),
      verifiedResources
    );
  });
});
