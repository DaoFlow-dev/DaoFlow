import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];
const mockedModuleIds = [
  "../auth",
  "../db/services/seed",
  "../db/services/direct-deployments",
  "../db/services/deployments",
  "../db/services/deployment-dispatch",
  "../db/services/deployment-capacity",
  "../db/services/teams",
  "../db/services/json-helpers",
  "../worker/docker-executor",
  "../worker/uploaded-artifacts",
  "./stream-to-file"
] as const;

class DeploymentQueueFullError extends Error {
  readonly code = "DEPLOYMENT_QUEUE_FULL";

  constructor(
    readonly details: {
      serverId: string;
      maxQueuedDeployments: number;
      queuedDeploymentCount: number;
    }
  ) {
    super(`Deployment queue for server ${details.serverId} is full.`);
  }

  get serverId() {
    return this.details.serverId;
  }

  get maxQueuedDeployments() {
    return this.details.maxQueuedDeployments;
  }

  get queuedDeploymentCount() {
    return this.details.queuedDeploymentCount;
  }
}

async function loadHarness() {
  const stageDir = mkdtempSync(join(tmpdir(), "daoflow-deploy-context-"));
  tempDirs.push(stageDir);
  const ensureControlPlaneReady = vi.fn();
  const ensureDirectDeploymentScope = vi.fn().mockResolvedValue({
    project: { id: "proj_123", name: "Project Demo" },
    environment: { id: "env_123", name: "Production" },
    service: { id: "svc_123", name: "demo", targetServerId: "srv_123" }
  });
  const createDeploymentRecord = vi.fn().mockResolvedValue({ id: "dep_123" });
  const dispatchDeploymentExecution = vi.fn();
  const persistUploadedArtifacts = vi.fn().mockResolvedValue({ artifactId: "artifact_123" });
  const cleanupStagingDir = vi.fn();
  const reserveDeploymentQueueSlot = vi.fn().mockResolvedValue({
    id: "dep_route_test",
    serverId: "srv_123",
    expiresAt: new Date("2030-01-01T00:00:00.000Z")
  });
  const releaseDeploymentQueueReservation = vi.fn();
  const streamBodyToFile = vi.fn();

  vi.doMock("../auth", () => ({
    auth: {
      api: {
        getSession: vi.fn().mockResolvedValue({
          user: {
            id: "user_123",
            email: "owner@daoflow.local",
            role: "owner"
          }
        })
      }
    }
  }));

  vi.doMock("../db/services/seed", () => ({
    ensureControlPlaneReady
  }));

  vi.doMock("../db/services/direct-deployments", () => ({
    ensureDirectDeploymentScope
  }));

  vi.doMock("../db/services/deployments", () => ({
    createDeploymentRecord
  }));

  vi.doMock("../db/services/deployment-dispatch", () => ({
    dispatchDeploymentExecution
  }));

  vi.doMock("../db/services/deployment-capacity", () => ({
    DEPLOYMENT_QUEUE_RESERVATION_TTL_MS: 60 * 60 * 1000,
    DeploymentQueueFullError,
    reserveDeploymentQueueSlot,
    releaseDeploymentQueueReservation
  }));

  vi.doMock("../db/services/teams", () => ({
    resolveTeamIdForUser: vi.fn().mockResolvedValue("team_foundation")
  }));

  vi.doMock("../db/services/json-helpers", () => ({
    newId: vi.fn(() => "dep_route_test")
  }));

  vi.doMock("../worker/docker-executor", () => ({
    cleanupStagingDir,
    ensureStagingDir: vi.fn(() => stageDir)
  }));

  vi.doMock("../worker/uploaded-artifacts", () => ({
    persistUploadedArtifacts
  }));

  vi.doMock("./stream-to-file", () => ({
    streamBodyToFile
  }));

  const { deployContextRouter } = await import("./deploy-context");

  return {
    cleanupStagingDir,
    createDeploymentRecord,
    deployContextRouter,
    dispatchDeploymentExecution,
    ensureControlPlaneReady,
    ensureDirectDeploymentScope,
    persistUploadedArtifacts,
    releaseDeploymentQueueReservation,
    reserveDeploymentQueueSlot,
    stageDir,
    streamBodyToFile
  };
}

describe("deployContextRouter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
    vi.restoreAllMocks();
    vi.clearAllMocks();
    for (const moduleId of mockedModuleIds) {
      vi.doUnmock(moduleId);
    }
    vi.resetModules();
    for (const stageDir of tempDirs.splice(0, tempDirs.length)) {
      rmSync(stageDir, { recursive: true, force: true });
    }
  });

  it("stages nested uploaded compose overrides within the deployment workspace", async () => {
    const { deployContextRouter, persistUploadedArtifacts, stageDir } = await loadHarness();

    const response = await deployContextRouter.request("/compose", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        server: "srv_123",
        compose: "services:\n  web:\n    image: nginx:alpine\n",
        composeFiles: [
          {
            path: "compose.yaml",
            contents: "services:\n  web:\n    image: nginx:alpine\n"
          },
          {
            path: "ops/compose.override.yaml",
            contents: "services:\n  web:\n    environment:\n      MODE: test\n"
          }
        ]
      })
    });
    const body = (await response.json()) as {
      ok: boolean;
      deploymentId: string;
      environmentId: string;
      projectId: string;
      serviceId: string;
    };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
    expect(body.projectId).toBe("proj_123");
    expect(body.environmentId).toBe("env_123");
    expect(body.serviceId).toBe("svc_123");
    expect(readFileSync(join(stageDir, "ops/compose.override.yaml"), "utf8")).toContain(
      "MODE: test"
    );
    expect(persistUploadedArtifacts).toHaveBeenCalledWith(
      expect.objectContaining({
        composeFileNames: ["compose.yaml", "ops/compose.override.yaml"]
      })
    );
  });

  it("rejects uploaded compose paths that escape the staged deployment workspace", async () => {
    const {
      cleanupStagingDir,
      deployContextRouter,
      persistUploadedArtifacts,
      releaseDeploymentQueueReservation
    } = await loadHarness();

    const response = await deployContextRouter.request("/compose", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        server: "srv_123",
        compose: "services:\n  web:\n    image: nginx:alpine\n",
        composeFiles: [
          {
            path: "../escape.yaml",
            contents: "services:\n  web:\n    image: nginx:alpine\n"
          }
        ]
      })
    });
    const body = (await response.json()) as { code: string; error: string; ok: boolean };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("INVALID_COMPOSE_FILE_PATH");
    expect(body.error).toContain("must stay within the staged deployment workspace");
    expect(persistUploadedArtifacts).not.toHaveBeenCalled();
    expect(cleanupStagingDir).toHaveBeenCalledWith("dep_route_test");
    expect(releaseDeploymentQueueReservation).toHaveBeenCalledWith(
      expect.objectContaining({
        reservationId: "dep_route_test",
        serverId: "srv_123"
      })
    );
  });

  it("rejects oversized uploaded compose bodies before staging artifacts", async () => {
    const { deployContextRouter, persistUploadedArtifacts } = await loadHarness();

    const response = await deployContextRouter.request("/compose", {
      method: "POST",
      headers: {
        "Content-Type": "application/json"
      },
      body: JSON.stringify({
        server: "srv_123",
        compose: "a".repeat(1_000_001)
      })
    });
    const body = (await response.json()) as { code: string; error: string; ok: boolean };

    expect(response.status).toBe(400);
    expect(body.ok).toBe(false);
    expect(body.code).toBe("INVALID_DEPLOY_CONTEXT_REQUEST");
    expect(body.error).toContain("exceed 1000000 bytes");
    expect(persistUploadedArtifacts).not.toHaveBeenCalled();
  });

  it("serializes queue-full responses before direct compose staging or artifact persistence", async () => {
    const {
      deployContextRouter,
      ensureDirectDeploymentScope,
      persistUploadedArtifacts,
      reserveDeploymentQueueSlot
    } = await loadHarness();
    reserveDeploymentQueueSlot.mockRejectedValueOnce(
      new DeploymentQueueFullError({
        serverId: "srv_123",
        maxQueuedDeployments: 1,
        queuedDeploymentCount: 1
      })
    );

    const response = await deployContextRouter.request("/compose", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server: "srv_123",
        compose: "services:\n  web:\n    image: nginx:alpine\n"
      })
    });
    const body = (await response.json()) as {
      code: string;
      maxQueuedDeployments: number;
      ok: boolean;
      queuedDeploymentCount: number;
      serverId: string;
    };

    expect(response.status).toBe(409);
    expect(body).toEqual({
      ok: false,
      error: "Deployment queue for server srv_123 is full.",
      code: "DEPLOYMENT_QUEUE_FULL",
      serverId: "srv_123",
      maxQueuedDeployments: 1,
      queuedDeploymentCount: 1
    });
    expect(persistUploadedArtifacts).not.toHaveBeenCalled();
    expect(ensureDirectDeploymentScope).not.toHaveBeenCalled();
  });

  it("serializes queue-full responses before upload intake creates a session", async () => {
    const { deployContextRouter, reserveDeploymentQueueSlot } = await loadHarness();
    reserveDeploymentQueueSlot.mockRejectedValueOnce(
      new DeploymentQueueFullError({
        serverId: "srv_123",
        maxQueuedDeployments: 1,
        queuedDeploymentCount: 1
      })
    );

    const response = await deployContextRouter.request("/uploads/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server: "srv_123",
        compose: "services:\n  web:\n    image: nginx:alpine\n"
      })
    });
    const body = (await response.json()) as { code: string; ok: boolean; serverId: string };

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      code: "DEPLOYMENT_QUEUE_FULL",
      serverId: "srv_123"
    });
  });

  it("serializes queue-full responses before a context archive is streamed or persisted", async () => {
    const { deployContextRouter, reserveDeploymentQueueSlot, streamBodyToFile } =
      await loadHarness();

    const intakeResponse = await deployContextRouter.request("/uploads/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server: "srv_123",
        compose: "services:\n  web:\n    image: nginx:alpine\n"
      })
    });
    expect(intakeResponse.status).toBe(200);

    reserveDeploymentQueueSlot.mockRejectedValueOnce(
      new DeploymentQueueFullError({
        serverId: "srv_123",
        maxQueuedDeployments: 1,
        queuedDeploymentCount: 1
      })
    );
    const response = await deployContextRouter.request("/uploads/dep_route_test", {
      method: "POST",
      body: "archive"
    });
    const body = (await response.json()) as { code: string; ok: boolean; serverId: string };

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      code: "DEPLOYMENT_QUEUE_FULL",
      serverId: "srv_123"
    });
    expect(streamBodyToFile).not.toHaveBeenCalled();
  });

  it("renews upload queue capacity before persisting a long-running archive", async () => {
    const {
      cleanupStagingDir,
      deployContextRouter,
      ensureDirectDeploymentScope,
      persistUploadedArtifacts,
      reserveDeploymentQueueSlot,
      streamBodyToFile
    } = await loadHarness();

    const intakeResponse = await deployContextRouter.request("/uploads/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server: "srv_123",
        compose: "services:\n  web:\n    image: nginx:alpine\n"
      })
    });
    expect(intakeResponse.status).toBe(200);

    reserveDeploymentQueueSlot
      .mockResolvedValueOnce({
        id: "dep_route_test",
        serverId: "srv_123",
        expiresAt: new Date("2030-01-01T00:00:00.000Z")
      })
      .mockRejectedValueOnce(
        new DeploymentQueueFullError({
          serverId: "srv_123",
          maxQueuedDeployments: 1,
          queuedDeploymentCount: 1
        })
      );

    const response = await deployContextRouter.request("/uploads/dep_route_test", {
      method: "POST",
      body: "archive"
    });
    const body = (await response.json()) as { code: string; ok: boolean; serverId: string };

    expect(response.status).toBe(409);
    expect(body).toMatchObject({
      ok: false,
      code: "DEPLOYMENT_QUEUE_FULL",
      serverId: "srv_123"
    });
    expect(streamBodyToFile).toHaveBeenCalledTimes(1);
    expect(reserveDeploymentQueueSlot).toHaveBeenCalledTimes(3);
    expect(persistUploadedArtifacts).not.toHaveBeenCalled();
    expect(ensureDirectDeploymentScope).not.toHaveBeenCalled();
    expect(cleanupStagingDir).toHaveBeenCalledWith("dep_route_test");
  });

  it("cleans up an upload when its active queue reservation heartbeat fails", async () => {
    const {
      cleanupStagingDir,
      deployContextRouter,
      persistUploadedArtifacts,
      releaseDeploymentQueueReservation,
      reserveDeploymentQueueSlot,
      streamBodyToFile
    } = await loadHarness();
    const renewalError = new Error("reservation expired during upload");

    const intakeResponse = await deployContextRouter.request("/uploads/intake", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        server: "srv_123",
        compose: "services:\n  web:\n    image: nginx:alpine\n"
      })
    });
    expect(intakeResponse.status).toBe(200);

    reserveDeploymentQueueSlot
      .mockResolvedValueOnce({
        id: "dep_route_test",
        serverId: "srv_123",
        expiresAt: new Date("2030-01-01T00:00:00.000Z")
      })
      .mockRejectedValueOnce(renewalError);
    streamBodyToFile.mockImplementationOnce(
      async (
        _body: ReadableStream,
        _destination: string,
        options?: { heartbeat?: () => Promise<void> }
      ) => {
        await options?.heartbeat?.();
      }
    );

    const response = await deployContextRouter.request("/uploads/dep_route_test", {
      method: "POST",
      body: "archive"
    });
    const body = (await response.json()) as { code: string; error: string; ok: boolean };

    expect(response.status).toBe(500);
    expect(body).toEqual({
      ok: false,
      error: "reservation expired during upload",
      code: "DEPLOY_CONTEXT_FAILED"
    });
    expect(persistUploadedArtifacts).not.toHaveBeenCalled();
    expect(cleanupStagingDir).toHaveBeenCalledWith("dep_route_test");
    expect(releaseDeploymentQueueReservation).toHaveBeenCalledWith({
      reservationId: "dep_route_test",
      serverId: "srv_123",
      expiresAt: new Date("2030-01-01T00:00:00.000Z")
    });
  });
});
