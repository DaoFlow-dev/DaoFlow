import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { serverOperationLogs, serverOperations } from "../schema/server-operations";
import { resetSeededTestDatabase } from "../../test-db";
import {
  closeHostTerminalOperation,
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
    await resetSeededTestDatabase();
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
