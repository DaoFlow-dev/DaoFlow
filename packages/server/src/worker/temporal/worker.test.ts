import { beforeEach, describe, expect, it, vi } from "vitest";

const connectMock = vi.fn();
const workerCreateMock = vi.fn();
const workerRunMock = vi.fn();
const workerShutdownMock = vi.fn();

vi.mock("@temporalio/worker", () => ({
  NativeConnection: {
    connect: connectMock
  },
  Worker: {
    create: workerCreateMock
  }
}));

vi.mock("./activities/deploy-activities", () => ({
  deployActivity: vi.fn()
}));

vi.mock("./activities/backup-activities", () => ({
  createBackupRun: vi.fn()
}));

vi.mock("./activities/backup-log-activities", () => ({
  appendBackupRunLog: vi.fn()
}));

vi.mock("./activities/database-activities", () => ({
  executeDatabaseDump: vi.fn()
}));

vi.mock("./activities/retention-activities", () => ({
  applyRetentionPolicy: vi.fn()
}));

vi.mock("./activities/notification-activities", () => ({
  sendSuccessNotification: vi.fn()
}));

describe("startTemporalWorker", () => {
  beforeEach(() => {
    vi.resetModules();
    connectMock.mockReset();
    workerCreateMock.mockReset();
    workerRunMock.mockReset();
    workerShutdownMock.mockReset();

    connectMock.mockResolvedValue({ connection: "native" });
    workerRunMock.mockResolvedValue(undefined);
    workerCreateMock.mockResolvedValue({
      run: workerRunMock,
      shutdown: workerShutdownMock
    });
  });

  it("registers backup run log activities with the Temporal worker", async () => {
    const { startTemporalWorker } = await import("./worker");

    await startTemporalWorker();

    expect(workerCreateMock).toHaveBeenCalledTimes(1);
    const firstCall = workerCreateMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [createArgs] = firstCall as [{ activities: Record<string, unknown> }];
    expect(createArgs.activities).toHaveProperty("appendBackupRunLog");
  });
});
