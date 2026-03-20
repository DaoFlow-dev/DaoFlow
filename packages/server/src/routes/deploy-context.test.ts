import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const tempDirs: string[] = [];

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
    streamBodyToFile: vi.fn()
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
    stageDir
  };
}

describe("deployContextRouter", () => {
  beforeEach(() => {
    vi.resetModules();
    vi.clearAllMocks();
  });

  afterEach(() => {
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
    const body = (await response.json()) as { ok: boolean };

    expect(response.status).toBe(200);
    expect(body.ok).toBe(true);
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
    const { cleanupStagingDir, deployContextRouter, persistUploadedArtifacts } =
      await loadHarness();

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
});
