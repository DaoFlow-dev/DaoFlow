import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { deployments } from "../db/schema/deployments";
import { servers } from "../db/schema/servers";
import { services } from "../db/schema/services";
import { createEnvironment, createProject } from "../db/services/projects";
import { createService } from "../db/services/services";
import { cancelDeployment } from "../db/services/deployments";
import { resetTestDatabaseWithControlPlane } from "../test-db";

const {
  cleanupStagingDirMock,
  createLogStreamerMock,
  executeComposeDeploymentMock,
  executeDockerfileDeploymentMock,
  executeImageDeploymentMock,
  executeNixpacksDeploymentMock,
  executeBuildpackDeploymentMock,
  resolveExecutionTargetMock,
  withPreparedExecutionTargetMock
} = vi.hoisted(() => ({
  createLogStreamerMock: vi.fn(() => ({
    onLog: vi.fn(),
    flush: vi.fn().mockResolvedValue(undefined)
  })),
  resolveExecutionTargetMock: vi.fn(() => ({
    mode: "local" as const,
    serverKind: undefined as string | undefined
  })),
  withPreparedExecutionTargetMock: vi.fn(
    async (target, callback: (target: unknown) => Promise<void>) => {
      await callback(target);
    }
  ),
  executeComposeDeploymentMock: vi.fn(),
  executeDockerfileDeploymentMock: vi.fn(),
  executeImageDeploymentMock: vi.fn(),
  executeNixpacksDeploymentMock: vi.fn(),
  executeBuildpackDeploymentMock: vi.fn(),
  cleanupStagingDirMock: vi.fn()
}));

vi.mock("./log-streamer", () => ({
  createLogStreamer: createLogStreamerMock
}));

vi.mock("./execution-target", () => ({
  resolveExecutionTarget: resolveExecutionTargetMock,
  withPreparedExecutionTarget: withPreparedExecutionTargetMock
}));

vi.mock("./deploy-strategies", () => ({
  executeComposeDeployment: executeComposeDeploymentMock,
  executeDockerfileDeployment: executeDockerfileDeploymentMock,
  executeImageDeployment: executeImageDeploymentMock,
  executeNixpacksDeployment: executeNixpacksDeploymentMock,
  executeBuildpackDeployment: executeBuildpackDeploymentMock
}));

vi.mock("./docker-executor", () => ({
  cleanupStagingDir: cleanupStagingDirMock
}));

async function createDeploymentRecordFixture(sourceType: "compose" | "image" = "compose") {
  const projectResult = await createProject({
    name: sourceType === "image" ? `Run Deployment ${Date.now()}` : `run-deployment-${Date.now()}`,
    description: "Run deployment cancellation fixture",
    teamId: "team_foundation",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(projectResult.status).toBe("ok");
  if (projectResult.status !== "ok") {
    throw new Error("Failed to create run deployment fixture project.");
  }

  const environmentResult = await createEnvironment({
    projectId: projectResult.project.id,
    name: `run-env-${Date.now()}`,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(environmentResult.status).toBe("ok");
  if (environmentResult.status !== "ok") {
    throw new Error("Failed to create run deployment fixture environment.");
  }

  const serviceResult = await createService({
    name: `run-svc-${Date.now()}`,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    sourceType,
    targetServerId: "srv_foundation_1",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner"
  });
  expect(serviceResult.status).toBe("ok");
  if (serviceResult.status !== "ok") {
    throw new Error("Failed to create run deployment fixture service.");
  }

  const deploymentId = `runfixture${Date.now()}`.slice(0, 32);
  await db.insert(deployments).values({
    id: deploymentId,
    projectId: projectResult.project.id,
    environmentId: environmentResult.environment.id,
    targetServerId: "srv_foundation_1",
    serviceId: serviceResult.service.id,
    serviceName: serviceResult.service.name,
    sourceType,
    commitSha: "1111111111111111111111111111111111111111",
    imageTag: "ghcr.io/example/api:test",
    status: "queued",
    configSnapshot: {
      projectName: projectResult.project.name,
      environmentName: environmentResult.environment.name
    },
    createdAt: new Date(),
    updatedAt: new Date()
  });

  const [deployment] = await db
    .select()
    .from(deployments)
    .where(eq(deployments.id, deploymentId))
    .limit(1);

  if (!deployment) {
    throw new Error("Failed to insert run deployment fixture.");
  }

  return deployment;
}

describe("runDeployment", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetTestDatabaseWithControlPlane();
  });

  it("marks a deployment cancelled when a user requests cancellation mid-run", async () => {
    const deployment = await createDeploymentRecordFixture();

    executeComposeDeploymentMock.mockImplementationOnce(async () => {
      const result = await cancelDeployment({
        deploymentId: deployment.id,
        teamId: "team_foundation",
        cancelledByUserId: "user_foundation_owner",
        cancelledByEmail: "owner@daoflow.local",
        cancelledByRole: "owner"
      });
      expect(result.status).toBe("cancellation-requested");
    });

    const { runDeployment } = await import("./run-deployment");
    const outcome = await runDeployment(deployment, "test-worker");

    expect(outcome).toBe("cancelled");

    const [updated] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deployment.id))
      .limit(1);

    expect(updated?.status).toBe("failed");
    expect(updated?.conclusion).toBe("cancelled");
    expect(cleanupStagingDirMock).toHaveBeenCalledWith(deployment.id);
  });

  it("passes the resolved Swarm manager target kind into compose execution", async () => {
    await db
      .update(servers)
      .set({ kind: "docker-swarm-manager" })
      .where(eq(servers.id, "srv_foundation_1"));
    resolveExecutionTargetMock.mockReturnValueOnce({
      mode: "local",
      serverKind: "docker-swarm-manager"
    });

    const deployment = await createDeploymentRecordFixture();

    const { runDeployment } = await import("./run-deployment");
    const outcome = await runDeployment(deployment, "test-worker");

    expect(outcome).toBe("succeeded");
    expect(resolveExecutionTargetMock).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "srv_foundation_1",
        kind: "docker-swarm-manager"
      }),
      deployment.id,
      "team_foundation"
    );
    expect(executeComposeDeploymentMock).toHaveBeenCalledWith(
      deployment,
      expect.any(Object),
      expect.any(String),
      expect.objectContaining({
        teamId: "team_foundation",
        projectId: deployment.projectId,
        environmentId: deployment.environmentId
      }),
      expect.any(Function),
      expect.objectContaining({
        serverKind: "docker-swarm-manager"
      }),
      expect.any(AbortSignal)
    );
  });

  it("sanitizes image deployment container names before docker run", async () => {
    const deployment = await createDeploymentRecordFixture("image");

    const { runDeployment } = await import("./run-deployment");
    const outcome = await runDeployment(deployment, "test-worker");

    expect(outcome).toBe("succeeded");
    expect(executeImageDeploymentMock).toHaveBeenCalledWith(
      deployment,
      expect.any(Object),
      expect.stringMatching(/^run-deployment-\d+-run-svc-\d+$/),
      expect.objectContaining({
        teamId: "team_foundation",
        projectId: deployment.projectId,
        environmentId: deployment.environmentId
      }),
      expect.any(Function),
      expect.any(Object),
      expect.any(AbortSignal)
    );
  });

  it("aborts deployment work when the execution deadline expires", async () => {
    const deployment = await createDeploymentRecordFixture();
    let strategySignal: AbortSignal | undefined;
    executeComposeDeploymentMock.mockImplementationOnce(
      async (...args: Parameters<typeof executeComposeDeploymentMock>) => {
        strategySignal = args[6] as AbortSignal;
        await new Promise<void>((_resolve, reject) => {
          strategySignal?.addEventListener(
            "abort",
            () =>
              reject(
                strategySignal?.reason instanceof Error
                  ? strategySignal.reason
                  : new Error("Deployment execution cancelled.")
              ),
            { once: true }
          );
        });
      }
    );

    const { runDeployment } = await import("./run-deployment");
    await expect(runDeployment(deployment, "test-worker", undefined, 20)).rejects.toThrow(
      "Deployment timed out after 0.02s"
    );

    const [updated] = await db
      .select()
      .from(deployments)
      .where(eq(deployments.id, deployment.id))
      .limit(1);

    expect(strategySignal?.aborted).toBe(true);
    expect(updated?.status).toBe("failed");
    expect(updated?.conclusion).toBe("failed");
    expect(cleanupStagingDirMock).toHaveBeenCalledWith(deployment.id);
  });

  it("fails closed before strategy execution when the immutable deployment service is missing", async () => {
    const deployment = await createDeploymentRecordFixture();

    await expect(
      (await import("./run-deployment")).runDeployment(
        { ...deployment, serviceId: "service_missing" },
        "test-worker"
      )
    ).rejects.toThrow("does not resolve to exactly one matching project, environment, and service");

    expect(executeComposeDeploymentMock).not.toHaveBeenCalled();
    expect(executeDockerfileDeploymentMock).not.toHaveBeenCalled();
    expect(executeImageDeploymentMock).not.toHaveBeenCalled();
    expect(executeNixpacksDeploymentMock).not.toHaveBeenCalled();
    expect(executeBuildpackDeploymentMock).not.toHaveBeenCalled();
  });

  it("uses the immutable deployment service after mutable service fields change", async () => {
    const deployment = await createDeploymentRecordFixture();
    await db
      .update(services)
      .set({ name: "renamed-service", sourceType: "image" })
      .where(eq(services.id, deployment.serviceId));

    await expect(
      (await import("./run-deployment")).runDeployment(deployment, "test-worker")
    ).resolves.toBe("succeeded");

    expect(executeComposeDeploymentMock).toHaveBeenCalledOnce();
    expect(executeImageDeploymentMock).not.toHaveBeenCalled();
  });
});
