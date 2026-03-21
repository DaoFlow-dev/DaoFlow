import { beforeEach, describe, expect, it, vi } from "vitest";
import { eq } from "drizzle-orm";
import { db } from "../db/connection";
import { deployments } from "../db/schema/deployments";
import { servers } from "../db/schema/servers";
import { createEnvironment, createProject } from "../db/services/projects";
import { createService } from "../db/services/services";
import { cancelDeployment } from "../db/services/deployments";
import { ensureControlPlaneReady, resetControlPlaneSeedState } from "../db/services/seed";
import { resetTestDatabase } from "../test-db";

const {
  cleanupStagingDirMock,
  createLogStreamerMock,
  executeComposeDeploymentMock,
  executeImageDeploymentMock,
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
  executeImageDeploymentMock: vi.fn(),
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
  executeDockerfileDeployment: vi.fn(),
  executeImageDeployment: executeImageDeploymentMock
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
    sourceType: "compose",
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
    await resetTestDatabase();
    resetControlPlaneSeedState();
    await ensureControlPlaneReady();
  });

  it("marks a deployment cancelled when a user requests cancellation mid-run", async () => {
    const deployment = await createDeploymentRecordFixture();

    executeComposeDeploymentMock.mockImplementationOnce(async () => {
      const result = await cancelDeployment({
        deploymentId: deployment.id,
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
      deployment.id
    );
    expect(executeComposeDeploymentMock).toHaveBeenCalledWith(
      deployment,
      expect.any(Object),
      expect.any(String),
      expect.any(Function),
      expect.objectContaining({
        serverKind: "docker-swarm-manager"
      })
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
      expect.any(Function),
      expect.any(Object)
    );
  });
});
