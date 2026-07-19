import { describe, expect, it } from "vitest";

import {
  resolveControlPlaneRecoveryKeyMetadata,
  resolveControlPlaneRecoveryKeySet
} from "./control-plane-recovery-key";

describe("control-plane recovery key configuration", () => {
  it("requires the dedicated key instead of falling back to ENCRYPTION_KEY", () => {
    expect(() =>
      resolveControlPlaneRecoveryKeyMetadata({
        NODE_ENV: "production",
        ENCRYPTION_KEY: "application-key-that-must-not-be-used-for-recovery"
      })
    ).toThrow("DAOFLOW_RECOVERY_ENCRYPTION_KEY");
  });

  it("returns only safe metadata and accepts a previous recovery key", () => {
    const current = "current-recovery-key-material-that-is-long-enough";
    const previous = "previous-recovery-key-material-that-is-long-enough";
    const metadata = resolveControlPlaneRecoveryKeyMetadata({
      NODE_ENV: "production",
      DAOFLOW_RECOVERY_ENCRYPTION_KEY: current,
      DAOFLOW_PREVIOUS_RECOVERY_ENCRYPTION_KEY: previous,
      DAOFLOW_RECOVERY_KEY_ROTATED_AT: "2026-07-18T12:00:00.000Z"
    });

    expect(metadata.fingerprint).toMatch(/^[a-f0-9]{64}$/);
    expect(metadata.rotatedAt).toBe("2026-07-18T12:00:00.000Z");
    expect(metadata).not.toHaveProperty("currentKeyMaterial");
    expect(metadata).not.toHaveProperty("previousKeyMaterial");
    expect(
      resolveControlPlaneRecoveryKeySet({ DAOFLOW_RECOVERY_ENCRYPTION_KEY: current })
    ).toMatchObject({ currentKeyMaterial: current, previousKeyMaterial: null });
  });
});
