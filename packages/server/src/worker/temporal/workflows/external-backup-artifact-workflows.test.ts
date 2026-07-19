import { describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const executeRestore = vi.fn();
  return {
    executeRestore,
    proxyActivities: vi
      .fn()
      .mockReturnValueOnce({
        importExternalBackupArtifact: vi.fn(),
        verifyExternalBackupArtifact: vi.fn()
      })
      .mockReturnValueOnce({ executeExternalArtifactRestore: executeRestore })
  };
});

vi.mock("@temporalio/workflow", () => ({
  proxyActivities: mocks.proxyActivities
}));

import { externalArtifactRestoreWorkflow } from "./external-backup-artifact-workflows";

describe("external artifact restore workflow", () => {
  it("does not retry the destructive production restore activity", async () => {
    const input = {
      artifactId: "xart_1",
      restoreId: "brest_1",
      targetVolumeId: "vol_1",
      approval: {}
    } as never;

    await externalArtifactRestoreWorkflow(input);

    expect(mocks.proxyActivities).toHaveBeenNthCalledWith(
      2,
      expect.objectContaining({ retry: { maximumAttempts: 1 } })
    );
    expect(mocks.executeRestore).toHaveBeenCalledTimes(1);
    expect(mocks.executeRestore).toHaveBeenCalledWith(input);
  });
});
