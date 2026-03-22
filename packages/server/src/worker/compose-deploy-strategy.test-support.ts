import { vi, type Mock } from "vitest";
import type { ComposeBuildPlan } from "../compose-build-plan";
import type {
  ComposeHealthStatusResult,
  SwarmHealthStatusResult
} from "./compose-deploy-health-status";

const mockState = vi.hoisted(() => ({
  buildPlan: null as ComposeBuildPlan | null,
  readinessProbeSnapshot: null as Record<string, unknown> | null,
  composeStatuses: null as Array<{
    service: string;
    name: string;
    state: string;
    status: string;
    health: string | null;
    exitCode: number | null;
  }> | null,
  swarmServiceStatuses: null as Array<{
    id: string;
    name: string;
    mode: string;
    replicas: string;
    image: string;
    ports: string | null;
  }> | null,
  swarmTaskStatuses: null as Array<{
    id: string;
    name: string;
    image: string;
    node: string | null;
    desiredState: string;
    currentState: string;
    error: string | null;
    ports: string | null;
  }> | null,
  swarmTaskAddressesById: null as Record<string, string[]> | null
}));

const mocks = vi.hoisted(() => ({
  persistDeploymentComposeEnvState: vi.fn(),
  readComposeReadinessProbeSnapshot: vi.fn(),
  prepareComposeWorkspace: vi.fn(),
  execStreaming: vi.fn(),
  dockerComposePull: vi.fn(),
  dockerComposeBuild: vi.fn(),
  dockerComposeDown: vi.fn(),
  dockerComposeUp: vi.fn(),
  dockerComposePs: vi.fn(),
  dockerStackDeploy: vi.fn(),
  dockerStackRemove: vi.fn(),
  dockerStackServices: vi.fn(),
  dockerStackPs: vi.fn(),
  dockerInspectSwarmTaskNetworkAddresses: vi.fn(),
  remoteDockerComposeBuild: vi.fn(),
  remoteDockerComposeDown: vi.fn(),
  remoteDockerComposePs: vi.fn(),
  remoteDockerComposePull: vi.fn(),
  remoteDockerComposeUp: vi.fn(),
  remoteDockerStackDeploy: vi.fn(),
  remoteDockerInspectSwarmTaskNetworkAddresses: vi.fn(),
  remoteDockerStackRemove: vi.fn(),
  remoteDockerStackServices: vi.fn(),
  remoteDockerStackPs: vi.fn(),
  createStep: vi.fn(),
  markStepRunning: vi.fn(),
  markStepComplete: vi.fn(),
  markStepFailed: vi.fn(),
  transitionDeployment: vi.fn(),
  runComposeHealthReadinessCheck: vi.fn(),
  runSwarmHealthReadinessCheck: vi.fn(),
  readComposeHealthStatuses: vi.fn(),
  readSwarmHealthStatuses: vi.fn()
}));

vi.mock("../db/services/compose-env", () => ({
  persistDeploymentComposeEnvState: mocks.persistDeploymentComposeEnvState,
  readDeploymentComposeState: vi.fn(() => ({
    envState: {
      kind: "queued",
      entries: []
    }
  }))
}));

vi.mock("../compose-readiness", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../compose-readiness")>();
  return {
    ...actual,
    readComposeReadinessProbeSnapshot: mocks.readComposeReadinessProbeSnapshot
  };
});

vi.mock("./compose-workspace", () => ({
  prepareComposeWorkspace: mocks.prepareComposeWorkspace
}));

vi.mock("./docker-executor", () => ({
  execStreaming: mocks.execStreaming,
  dockerComposeBuild: mocks.dockerComposeBuild,
  dockerComposeDown: mocks.dockerComposeDown,
  dockerComposePs: mocks.dockerComposePs,
  dockerComposePull: mocks.dockerComposePull,
  dockerComposeUp: mocks.dockerComposeUp
}));

vi.mock("./swarm-executor", () => ({
  dockerStackDeploy: mocks.dockerStackDeploy,
  dockerInspectSwarmTaskNetworkAddresses: mocks.dockerInspectSwarmTaskNetworkAddresses,
  dockerStackRemove: mocks.dockerStackRemove,
  dockerStackServices: mocks.dockerStackServices,
  dockerStackPs: mocks.dockerStackPs
}));

vi.mock("./ssh-executor", () => ({
  remoteDockerComposeBuild: mocks.remoteDockerComposeBuild,
  remoteDockerComposeDown: mocks.remoteDockerComposeDown,
  remoteDockerComposePs: mocks.remoteDockerComposePs,
  remoteDockerComposePull: mocks.remoteDockerComposePull,
  remoteDockerComposeUp: mocks.remoteDockerComposeUp,
  remoteDockerStackDeploy: mocks.remoteDockerStackDeploy,
  remoteDockerInspectSwarmTaskNetworkAddresses: mocks.remoteDockerInspectSwarmTaskNetworkAddresses,
  remoteDockerStackRemove: mocks.remoteDockerStackRemove,
  remoteDockerStackServices: mocks.remoteDockerStackServices,
  remoteDockerStackPs: mocks.remoteDockerStackPs
}));

vi.mock("./step-management", () => ({
  createStep: mocks.createStep,
  markStepRunning: mocks.markStepRunning,
  markStepComplete: mocks.markStepComplete,
  markStepFailed: mocks.markStepFailed,
  transitionDeployment: mocks.transitionDeployment
}));

vi.mock("./compose-deploy-health-readiness", () => ({
  runComposeHealthReadinessCheck: mocks.runComposeHealthReadinessCheck,
  runSwarmHealthReadinessCheck: mocks.runSwarmHealthReadinessCheck
}));

vi.mock("./compose-deploy-health-status", () => ({
  readComposeHealthStatuses: mocks.readComposeHealthStatuses,
  readSwarmHealthStatuses: mocks.readSwarmHealthStatuses
}));

export function createLocalBuildService(
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

export function createHealthyStatus(service: string) {
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

export function createBuildPlan(input: {
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

interface ComposeDeployStrategyHarness {
  executeComposeDeployment: typeof import("./compose-deploy-strategy").executeComposeDeployment;
  persistDeploymentComposeEnvState: Mock;
  dockerComposeBuild: Mock;
  dockerComposeDown: Mock;
  dockerComposePs: Mock;
  dockerComposePull: Mock;
  dockerComposeUp: Mock;
  dockerStackDeploy: Mock;
  dockerInspectSwarmTaskNetworkAddresses: Mock;
  dockerStackRemove: Mock;
  dockerStackServices: Mock;
  dockerStackPs: Mock;
}

export async function loadHarness(input: {
  buildPlan: ComposeBuildPlan;
  readinessProbeSnapshot?: Record<string, unknown> | null;
  composeStatuses?: Array<{
    service: string;
    name: string;
    state: string;
    status: string;
    health: string | null;
    exitCode: number | null;
  }>;
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
  swarmTaskAddressesById?: Record<string, string[]>;
}): Promise<ComposeDeployStrategyHarness> {
  mockState.buildPlan = input.buildPlan;
  mockState.readinessProbeSnapshot = input.readinessProbeSnapshot ?? null;
  mockState.composeStatuses = input.composeStatuses ?? [createHealthyStatus("api")];
  mockState.swarmServiceStatuses = input.swarmServiceStatuses ?? [
    {
      id: "stack_api",
      name: "demo_api",
      mode: "replicated",
      replicas: "1/1",
      image: "ghcr.io/example/api:stable",
      ports: null
    }
  ];
  mockState.swarmTaskStatuses = input.swarmTaskStatuses ?? [
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
  ];
  mockState.swarmTaskAddressesById = input.swarmTaskAddressesById ?? {};

  const { executeComposeDeployment } = await import("./compose-deploy-strategy");

  return {
    executeComposeDeployment,
    persistDeploymentComposeEnvState: mocks.persistDeploymentComposeEnvState,
    dockerComposeBuild: mocks.dockerComposeBuild,
    dockerComposeDown: mocks.dockerComposeDown,
    dockerComposePs: mocks.dockerComposePs,
    dockerComposePull: mocks.dockerComposePull,
    dockerComposeUp: mocks.dockerComposeUp,
    dockerStackDeploy: mocks.dockerStackDeploy,
    dockerInspectSwarmTaskNetworkAddresses: mocks.dockerInspectSwarmTaskNetworkAddresses,
    dockerStackRemove: mocks.dockerStackRemove,
    dockerStackServices: mocks.dockerStackServices,
    dockerStackPs: mocks.dockerStackPs
  };
}

export function resetComposeDeployStrategyHarness() {
  mockState.buildPlan = null;
  mockState.readinessProbeSnapshot = null;
  mockState.composeStatuses = null;
  mockState.swarmServiceStatuses = null;
  mockState.swarmTaskStatuses = null;
  mockState.swarmTaskAddressesById = null;
  vi.clearAllMocks();

  mocks.readComposeReadinessProbeSnapshot.mockImplementation(
    () => mockState.readinessProbeSnapshot
  );
  mocks.prepareComposeWorkspace.mockImplementation(() => {
    if (!mockState.buildPlan) {
      throw new Error("Missing build plan test setup");
    }

    return createComposeWorkspace(mockState.buildPlan);
  });
  mocks.execStreaming.mockResolvedValue({ exitCode: 0 });
  mocks.dockerComposePull.mockResolvedValue({ exitCode: 0 });
  mocks.dockerComposeBuild.mockResolvedValue({ exitCode: 0 });
  mocks.dockerComposeDown.mockResolvedValue({ exitCode: 0 });
  mocks.dockerComposeUp.mockResolvedValue({ exitCode: 0 });
  mocks.dockerComposePs.mockImplementation(() =>
    Promise.resolve({
      exitCode: 0,
      statuses: mockState.composeStatuses ?? [createHealthyStatus("api")]
    })
  );
  mocks.dockerStackDeploy.mockResolvedValue({ exitCode: 0 });
  mocks.dockerStackRemove.mockResolvedValue({ exitCode: 0 });
  mocks.dockerStackServices.mockImplementation(() =>
    Promise.resolve({
      exitCode: 0,
      services: mockState.swarmServiceStatuses ?? []
    })
  );
  mocks.dockerStackPs.mockImplementation(() =>
    Promise.resolve({
      exitCode: 0,
      tasks: mockState.swarmTaskStatuses ?? []
    })
  );
  mocks.dockerInspectSwarmTaskNetworkAddresses.mockImplementation((taskId: string) =>
    Promise.resolve({
      exitCode: 0,
      addresses: mockState.swarmTaskAddressesById?.[taskId] ?? []
    })
  );
  mocks.remoteDockerComposeBuild.mockResolvedValue({ exitCode: 0 });
  mocks.remoteDockerComposeDown.mockResolvedValue({ exitCode: 0 });
  mocks.remoteDockerComposePs.mockResolvedValue({ exitCode: 0, statuses: [] });
  mocks.remoteDockerComposePull.mockResolvedValue({ exitCode: 0 });
  mocks.remoteDockerComposeUp.mockResolvedValue({ exitCode: 0 });
  mocks.remoteDockerStackDeploy.mockResolvedValue({ exitCode: 0 });
  mocks.remoteDockerInspectSwarmTaskNetworkAddresses.mockResolvedValue({
    exitCode: 0,
    addresses: []
  });
  mocks.remoteDockerStackRemove.mockResolvedValue({ exitCode: 0 });
  mocks.remoteDockerStackServices.mockResolvedValue({ exitCode: 0, services: [] });
  mocks.remoteDockerStackPs.mockResolvedValue({ exitCode: 0, tasks: [] });
  mocks.createStep.mockResolvedValue(1);
  mocks.markStepRunning.mockResolvedValue(undefined);
  mocks.markStepComplete.mockResolvedValue(undefined);
  mocks.markStepFailed.mockResolvedValue(undefined);
  mocks.transitionDeployment.mockResolvedValue(undefined);
  mocks.runComposeHealthReadinessCheck.mockResolvedValue({
    kind: "success",
    summary: "readiness passed"
  });
  mocks.runSwarmHealthReadinessCheck.mockResolvedValue({
    kind: "success",
    summary: "readiness passed"
  });
  mocks.readComposeHealthStatuses.mockImplementation(
    (
      composeFile: string,
      projectName: string,
      workDir: string,
      onLog: (event: unknown) => void,
      _target: unknown,
      envFile?: string,
      _envExportFile?: string,
      composeServiceName?: string
    ): Promise<ComposeHealthStatusResult> =>
      mocks.dockerComposePs(
        composeFile,
        projectName,
        workDir,
        onLog,
        envFile,
        composeServiceName
      ) as Promise<ComposeHealthStatusResult>
  );
  mocks.readSwarmHealthStatuses.mockImplementation(
    (
      stackName: string,
      workDir: string,
      onLog: (event: unknown) => void
    ): Promise<SwarmHealthStatusResult> =>
      Promise.all([
        mocks.dockerStackServices(stackName, workDir, onLog),
        mocks.dockerStackPs(stackName, workDir, onLog)
      ]).then(([serviceResult, taskResult]) => ({
        serviceResult: serviceResult as SwarmHealthStatusResult["serviceResult"],
        taskResult: taskResult as SwarmHealthStatusResult["taskResult"]
      }))
  );
}

export function clearComposeDeployStrategyHarness() {
  vi.restoreAllMocks();
  vi.clearAllMocks();
}
