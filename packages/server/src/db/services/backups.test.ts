import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppRole } from "@daoflow/shared";

const { startOneOffBackupWorkflowMock, getBackupCronStatusMock, isTemporalEnabledMock } =
  vi.hoisted(() => ({
    startOneOffBackupWorkflowMock: vi.fn(),
    getBackupCronStatusMock: vi.fn(),
    isTemporalEnabledMock: vi.fn()
  }));

vi.mock("../../worker", async () => {
  const actual = await vi.importActual<typeof import("../../worker")>("../../worker");
  return {
    ...actual,
    getBackupCronStatus: getBackupCronStatusMock,
    startOneOffBackupWorkflow: startOneOffBackupWorkflowMock
  };
});

vi.mock("../../worker/temporal/temporal-config", async () => {
  const actual = await vi.importActual<typeof import("../../worker/temporal/temporal-config")>(
    "../../worker/temporal/temporal-config"
  );
  return {
    ...actual,
    isTemporalEnabled: isTemporalEnabledMock
  };
});

import { db } from "../connection";
import { backupRuns } from "../schema/storage";
import { listBackupOverview, triggerBackupRun } from "./backups";

describe("triggerBackupRun", () => {
  beforeEach(() => {
    getBackupCronStatusMock.mockReset();
    startOneOffBackupWorkflowMock.mockReset();
    isTemporalEnabledMock.mockReset();
    isTemporalEnabledMock.mockReturnValue(true);
    getBackupCronStatusMock.mockResolvedValue(null);
    startOneOffBackupWorkflowMock.mockResolvedValue({
      workflowId: "backup-run-test",
      runId: "temporal-run-test"
    });
  });

  it("queues a stable run record and dispatches the one-off backup through Temporal", async () => {
    const run = await triggerBackupRun(
      "bpol_foundation_db_hourly",
      "user_foundation_owner",
      "owner@daoflow.local",
      "owner" as AppRole
    );

    expect(run).toBeTruthy();
    expect(run?.status).toBe("queued");
    expect(run?.policyId).toBe("bpol_foundation_db_hourly");
    expect(run).toHaveProperty("workflowId", "backup-run-test");
    expect(startOneOffBackupWorkflowMock).toHaveBeenCalledWith(
      "bpol_foundation_db_hourly",
      "user_foundation_owner",
      run?.id
    );

    const [persisted] = await db
      .select()
      .from(backupRuns)
      .where(eq(backupRuns.id, run!.id))
      .limit(1);

    expect(persisted?.status).toBe("queued");
    expect(persisted?.triggeredByUserId).toBe("user_foundation_owner");

    await db.delete(backupRuns).where(eq(backupRuns.id, run!.id));
  });

  it("reports cron workflow status for scheduled policies when Temporal mode is enabled", async () => {
    getBackupCronStatusMock.mockResolvedValue({
      status: "RUNNING",
      workflowId: "backup-cron-bpol_foundation_db_hourly"
    });

    const overview = await listBackupOverview();
    const policy = overview.policies.find((entry) => entry.id === "bpol_foundation_db_hourly");

    expect(policy?.temporalWorkflowId).toBe("backup-cron-bpol_foundation_db_hourly");
    expect(policy?.temporalWorkflowStatus).toBe("RUNNING");
    expect(getBackupCronStatusMock).toHaveBeenCalledWith("bpol_foundation_db_hourly");
  });
});
