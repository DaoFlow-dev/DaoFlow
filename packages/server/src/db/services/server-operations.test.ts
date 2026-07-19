import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { serverOperationLogs, serverOperations } from "../schema/server-operations";
import { resetSeededTestDatabase } from "../../test-db";

const mocks = vi.hoisted(() => ({
  collectHostResourceSnapshot: vi.fn(),
  inspectDockerOwnedResources: vi.fn(),
  resolveExecutionTarget: vi.fn(),
  withPreparedExecutionTarget: vi.fn()
}));

vi.mock("../../worker/server-host-operations", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../worker/server-host-operations")>()),
  collectHostResourceSnapshot: mocks.collectHostResourceSnapshot
}));
vi.mock("../../worker/docker-owned-resource-inspection", () => ({
  inspectDockerOwnedResources: mocks.inspectDockerOwnedResources
}));
vi.mock("../../worker/execution-target", () => ({
  resolveExecutionTarget: mocks.resolveExecutionTarget,
  withPreparedExecutionTarget: mocks.withPreparedExecutionTarget
}));

import {
  closeHostTerminalOperation,
  collectServerResources,
  createHostTerminalOperation,
  runServerCleanup
} from "./server-operations";

const actor = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};
const teamId = "team_foundation";

describe("server operations service", () => {
  beforeEach(async () => {
    vi.clearAllMocks();
    await resetSeededTestDatabase();
    const target = { mode: "local" as const, serverKind: "docker-engine" };
    mocks.resolveExecutionTarget.mockResolvedValue(target);
    mocks.withPreparedExecutionTarget.mockImplementation(
      (_target: unknown, run: (preparedTarget: typeof target) => Promise<unknown>) => run(target)
    );
    mocks.collectHostResourceSnapshot.mockResolvedValue({
      cpu: { cores: 4, load1: 0.5, loadPercent: 13 },
      memory: { totalMb: 8192, availableMb: 4096, usedPercent: 50 },
      disk: { mount: "/", totalGb: 100, usedGb: 20, availableGb: 80, usedPercent: 20 },
      docker: { reachable: true, diskUsage: [], summary: "Docker disk usage collected." },
      checkedAt: "2026-07-18T12:00:00.000Z"
    });
    mocks.inspectDockerOwnedResources.mockResolvedValue({
      checkedAt: "2026-07-18T12:00:00.000Z",
      containers: [],
      images: [],
      networks: [],
      volumes: [],
      services: [],
      issues: []
    });
  });

  it("persists an observe-only Docker ownership reconciliation with host resources", async () => {
    mocks.inspectDockerOwnedResources.mockResolvedValueOnce({
      checkedAt: "2026-07-18T12:00:00.000Z",
      containers: [
        {
          id: "container-owned-1",
          name: "daoflow-control-plane",
          labels: {
            "io.daoflow.managed": "true",
            "io.daoflow.team-id": teamId,
            "io.daoflow.project-id": "proj_daoflow_control_plane",
            "io.daoflow.environment-id": "env_daoflow_production",
            "io.daoflow.service-id": "svc_daoflow_prod_control",
            "io.daoflow.deployment-id": "dep_foundation_20260312_1"
          }
        }
      ],
      images: [],
      networks: [],
      volumes: [],
      services: [],
      issues: []
    });

    const result = await collectServerResources({
      serverId: "srv_foundation_1",
      teamId,
      actor
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") throw new Error("resource collection failed");
    expect(result.result.ownership).toMatchObject({
      serverId: "srv_foundation_1",
      summary: { valid: 1, invalid: 0, orphan: 0, inconsistent: 0 },
      resources: [
        {
          kind: "container",
          id: "container-owned-1",
          status: "valid",
          reasons: []
        }
      ],
      inspectionErrors: []
    });
    expect(result.operation.summary).toContain("reconciled 1 DaoFlow-managed Docker resources");

    const [operation] = await db
      .select()
      .from(serverOperations)
      .where(eq(serverOperations.id, result.operation.id));
    expect(operation.result).toMatchObject({
      ownership: {
        serverId: "srv_foundation_1",
        resources: [{ id: "container-owned-1", status: "valid" }]
      }
    });
  });

  it("requires a recent cleanup preview before running cleanup", async () => {
    const result = await runServerCleanup({
      serverId: "srv_foundation_1",
      teamId,
      actor
    });

    expect(result).toMatchObject({
      status: "preview_required",
      message: "Run a cleanup preview before executing host cleanup."
    });
  });

  it("records host terminal open and close as durable operations and audit rows", async () => {
    const opened = await createHostTerminalOperation({
      serverId: "srv_foundation_1",
      teamId,
      shell: "sh",
      actor
    });

    expect(opened.status).toBe("ok");
    if (opened.status !== "ok") throw new Error("terminal operation did not open");

    await closeHostTerminalOperation({
      operationId: opened.operation.id,
      actor,
      exitCode: 0
    });

    const [operation] = await db
      .select()
      .from(serverOperations)
      .where(eq(serverOperations.id, opened.operation.id));
    expect(operation).toMatchObject({
      kind: "host_terminal",
      status: "completed",
      permissionScope: "terminal:open"
    });

    const logs = await db
      .select()
      .from(serverOperationLogs)
      .where(eq(serverOperationLogs.operationId, opened.operation.id));
    expect(logs.map((log) => log.message)).toContain(
      "Opened sh host terminal for foundation-vps-1."
    );

    const audits = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.targetResource, "server/srv_foundation_1"));
    const auditActions = audits.map((entry) => entry.action);
    expect(auditActions).toHaveLength(2);
    expect(auditActions).toEqual(
      expect.arrayContaining(["server.terminal.open", "server.terminal.close"])
    );
  });
});
