import { afterEach, describe, expect, it } from "vitest";

import { controlPlaneRecoveryVerifierTestHooks } from "./control-plane-recovery-verifier";

const originalVerifierStorageMb = process.env.DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB;

afterEach(() => {
  if (originalVerifierStorageMb === undefined) {
    delete process.env.DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB;
  } else {
    process.env.DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB = originalVerifierStorageMb;
  }
});

describe("control-plane recovery verifier isolation", () => {
  it("creates a no-network verifier with a production-safe default storage limit", () => {
    const container = controlPlaneRecoveryVerifierTestHooks.makeRecoveryVerificationContainer(
      "recovery_217",
      "verify"
    );
    const args = controlPlaneRecoveryVerifierTestHooks.createRecoveryVerifierArgs(
      `pgvector/pgvector:pg17@sha256:${"a".repeat(64)}`,
      container,
      "recovery_217"
    );
    const joined = args.join(" ");

    expect(args).toEqual(
      expect.arrayContaining(["--network", "none", "--read-only", "--memory", "4096m"])
    );
    expect(joined).toContain("/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=4096m");
    expect(joined).not.toMatch(/DATABASE_URL|POSTGRES_PASSWORD|password=/i);
    expect(joined).toContain("com.daoflow.cleanup=required");
  });

  it("allows a bounded verifier storage limit to be configured", () => {
    process.env.DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB = "8192";
    const container = controlPlaneRecoveryVerifierTestHooks.makeRecoveryVerificationContainer(
      "recovery_217",
      "prepare"
    );
    const args = controlPlaneRecoveryVerifierTestHooks.createRecoveryVerifierArgs(
      `pgvector/pgvector:pg17@sha256:${"b".repeat(64)}`,
      container,
      "recovery_217"
    );

    expect(args).toEqual(expect.arrayContaining(["--memory", "8192m", "--memory-swap", "8192m"]));
    expect(args).toContain("/var/lib/postgresql/data:rw,nosuid,nodev,noexec,size=8192m,mode=0700");
  });

  it("rejects verifier storage settings outside the safe bounds", () => {
    expect(() =>
      controlPlaneRecoveryVerifierTestHooks.getControlPlaneRecoveryVerifierStorageMb({
        DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB: "511"
      })
    ).toThrow("DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB");
    expect(() =>
      controlPlaneRecoveryVerifierTestHooks.getControlPlaneRecoveryVerifierStorageMb({
        DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB: "65537"
      })
    ).toThrow("DAOFLOW_CONTROL_PLANE_RECOVERY_VERIFIER_STORAGE_MB");
  });
});
