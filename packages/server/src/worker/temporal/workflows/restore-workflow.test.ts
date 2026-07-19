import { beforeEach, describe, expect, it, vi } from "vitest";

const patchedMock = vi.hoisted(() => vi.fn());
const activities = vi.hoisted(() => ({
  resolveRestoreContext: vi.fn(),
  downloadBackupArtifact: vi.fn(),
  executeRestore: vi.fn(),
  cleanupRestoreDownload: vi.fn(),
  markRestoreSucceeded: vi.fn(),
  markRestoreFailed: vi.fn(),
  markBackupVerified: vi.fn(),
  emitRestoreEvent: vi.fn(),
  auditRestoreAction: vi.fn(),
  dispatchNotification: vi.fn(),
  buildBackupNotification: vi.fn()
}));

vi.mock("@temporalio/workflow", () => ({
  patched: patchedMock,
  proxyActivities: () => activities
}));

import { restoreWorkflow } from "./restore-workflow";

const legacyContext = {
  restoreId: "brest_legacy",
  runId: "brun_legacy",
  teamId: "team_foundation",
  artifactPath: "backups/legacy.dump",
  destinationId: "dest_legacy",
  volumeId: "vol_legacy",
  targetPath: "/tmp/daoflow-restore/brun_legacy",
  downloadPath: "/tmp/daoflow-restore/brest_legacy/download",
  encryptionMode: "none",
  backupType: "database",
  volumeName: "postgres"
};

beforeEach(() => {
  vi.clearAllMocks();
  activities.resolveRestoreContext.mockResolvedValue(legacyContext);
  activities.downloadBackupArtifact.mockResolvedValue({
    success: true,
    localPath: "/tmp/legacy.dump"
  });
  activities.executeRestore.mockResolvedValue({
    restoreId: legacyContext.restoreId,
    success: true,
    bytesRestored: 1
  });
  activities.cleanupRestoreDownload.mockResolvedValue(undefined);
  activities.markRestoreSucceeded.mockResolvedValue(undefined);
  activities.markBackupVerified.mockResolvedValue(undefined);
  activities.emitRestoreEvent.mockResolvedValue(undefined);
  activities.auditRestoreAction.mockResolvedValue(undefined);
  activities.buildBackupNotification.mockResolvedValue({});
  activities.dispatchNotification.mockResolvedValue(undefined);
});

describe("restore workflow compatibility", () => {
  it("replays pre-upgrade test restores with their original activity commands", async () => {
    patchedMock.mockReturnValue(false);

    await restoreWorkflow({
      restoreId: legacyContext.restoreId,
      backupRunId: legacyContext.runId,
      triggeredBy: "system",
      testRestore: true
    });

    expect(patchedMock).toHaveBeenCalledWith("restore-workflow-explicit-mode-v1");
    expect(activities.resolveRestoreContext).toHaveBeenCalledWith({
      restoreId: legacyContext.restoreId,
      backupRunId: legacyContext.runId,
      targetPath: undefined,
      triggeredBy: "system",
      testRestore: true
    });
    expect(activities.executeRestore).toHaveBeenCalledWith(legacyContext, {
      success: true,
      localPath: "/tmp/legacy.dump"
    });
    expect(activities.markRestoreSucceeded).toHaveBeenCalledWith(legacyContext.restoreId);
    expect(activities.markBackupVerified).toHaveBeenCalledWith(legacyContext.runId);
    expect(activities.auditRestoreAction).not.toHaveBeenCalledWith(
      legacyContext.restoreId,
      "backup.verify.succeeded",
      expect.anything()
    );
  });

  it("uses explicit verification mode only after recording the Temporal patch", async () => {
    patchedMock.mockReturnValue(true);
    const verificationResult = {
      version: 1,
      success: true,
      checksum: "a".repeat(64),
      sourceEngineVersion: "16.4",
      verifierEngineVersion: "16.4",
      durationMs: 1,
      checks: {},
      objectCounts: { schemas: 0, tables: 0, indexes: 0, functions: 0 },
      cleanup: { attempted: true, containerRemoved: true, workspaceRemoved: true },
      completedAt: "2026-07-18T00:00:00.000Z"
    };
    activities.resolveRestoreContext.mockResolvedValue({ ...legacyContext, mode: "verification" });
    activities.executeRestore.mockResolvedValue({
      restoreId: legacyContext.restoreId,
      success: true,
      bytesRestored: 1,
      verificationResult
    });

    await restoreWorkflow({
      restoreId: legacyContext.restoreId,
      backupRunId: legacyContext.runId,
      triggeredBy: "system",
      mode: "verification"
    });

    expect(activities.resolveRestoreContext).toHaveBeenCalledWith({
      restoreId: legacyContext.restoreId,
      backupRunId: legacyContext.runId,
      targetPath: undefined,
      triggeredBy: "system",
      mode: "verification"
    });
    expect(activities.markRestoreSucceeded).toHaveBeenCalledWith(
      legacyContext.restoreId,
      verificationResult
    );
    expect(activities.auditRestoreAction).toHaveBeenCalledWith(
      legacyContext.restoreId,
      "backup.verify.succeeded",
      expect.stringContaining("checksum")
    );
  });
});
