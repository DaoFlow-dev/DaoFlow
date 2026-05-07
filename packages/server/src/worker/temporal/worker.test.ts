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

vi.mock("./activities/restore-activities", () => ({
  resolveRestoreContext: vi.fn(),
  executeRestore: vi.fn()
}));

describe("startTemporalWorker", () => {
  beforeEach(() => {
    vi.resetModules();
    process.env.TEMPORAL_CONNECT_TIMEOUT_MS = "100";
    process.env.TEMPORAL_CONNECT_RETRY_DELAY_MS = "0";
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

  it("registers backup and restore activities with the Temporal worker", async () => {
    const { startTemporalWorker } = await import("./worker");

    await startTemporalWorker();

    expect(workerCreateMock).toHaveBeenCalledTimes(1);
    const firstCall = workerCreateMock.mock.calls[0];
    expect(firstCall).toBeDefined();
    const [createArgs] = firstCall as [{ activities: Record<string, unknown> }];
    expect(createArgs.activities).toHaveProperty("appendBackupRunLog");
    expect(createArgs.activities).toHaveProperty("resolveRestoreContext");
    expect(createArgs.activities).toHaveProperty("executeRestore");
  });

  it("retries the Temporal connection before starting the worker", async () => {
    connectMock
      .mockRejectedValueOnce(new Error("connect refused"))
      .mockResolvedValueOnce({ connection: "native" });

    const { startTemporalWorker } = await import("./worker");

    await startTemporalWorker();

    expect(connectMock).toHaveBeenCalledTimes(2);
    expect(workerCreateMock).toHaveBeenCalledTimes(1);
    expect(workerRunMock).toHaveBeenCalledTimes(1);
  });

  it("reports ready only after the Temporal worker is created", async () => {
    const lifecycleEvents: string[] = [];
    workerRunMock.mockImplementation(() => {
      lifecycleEvents.push("run");
      return Promise.resolve();
    });
    const { startTemporalWorker } = await import("./worker");

    await startTemporalWorker({
      onReady: () => {
        lifecycleEvents.push("ready");
      }
    });

    expect(workerCreateMock).toHaveBeenCalledTimes(1);
    expect(lifecycleEvents).toEqual(["ready", "run"]);
  });
});
