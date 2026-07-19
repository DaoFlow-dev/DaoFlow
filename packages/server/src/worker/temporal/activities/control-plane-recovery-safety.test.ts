import { describe, expect, it } from "vitest";
import { safeControlPlaneRecoveryError } from "./control-plane-recovery-safety";

describe("control-plane recovery error redaction", () => {
  it("removes database credentials and every recovery key spelling before persistence", () => {
    const safe = safeControlPlaneRecoveryError(
      new Error(
        "postgresql://owner:database-secret@postgres:5432/daoflow " +
          "password=plain-password key material=raw-key " +
          "recoveryKey:rotated-key private_key=ssh-key token=session-token"
      )
    );

    expect(safe).toContain("postgresql://[redacted]@postgres:5432/daoflow");
    expect(safe).toContain("password=[redacted]");
    expect(safe).toContain("key material=[redacted]");
    expect(safe).toContain("recoveryKey:[redacted]");
    expect(safe).toContain("private_key=[redacted]");
    expect(safe).toContain("token=[redacted]");
    expect(safe).not.toContain("database-secret");
    expect(safe).not.toContain("plain-password");
    expect(safe).not.toContain("raw-key");
    expect(safe).not.toContain("rotated-key");
    expect(safe).not.toContain("ssh-key");
    expect(safe).not.toContain("session-token");
  });
});
