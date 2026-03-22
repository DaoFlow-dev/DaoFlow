import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  clearComposeDeployStrategyHarness,
  createBuildPlan,
  createHealthyStatus,
  createLocalBuildService,
  loadHarness,
  resetComposeDeployStrategyHarness
} from "./compose-deploy-strategy.test-support";

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

  it("deploys Swarm manager targets with docker stack deploy semantics", async () => {
    const {
      executeComposeDeployment,
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
      () => undefined,
      { mode: "local", serverKind: "docker-swarm-manager" }
    );

    expect(dockerComposeUp).not.toHaveBeenCalled();
    expect(dockerStackDeploy).toHaveBeenCalledWith(
      ".daoflow.compose.inputs/compose-01__deploy__compose.yaml.yaml",
      "demo-stack",
      "/tmp/daoflow-build",
      expect.any(Function),
      ".daoflow.compose.env"
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

  it("removes preview stacks with docker stack rm on Swarm manager targets", async () => {
    const { executeComposeDeployment, dockerComposeDown, dockerStackRemove } = await loadHarness({
      buildPlan: createBuildPlan({
        strategy: "pull-only",
        services: []
      })
    });

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
      () => undefined,
      { mode: "local", serverKind: "docker-swarm-manager" }
    );

    expect(dockerComposeDown).not.toHaveBeenCalled();
    expect(dockerStackRemove).toHaveBeenCalledWith(
      "demo-stack-pr-42",
      "/tmp/daoflow-build",
      expect.any(Function)
    );
  });
});
