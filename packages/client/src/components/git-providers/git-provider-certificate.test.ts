import { describe, expect, it } from "vitest";
import { getCertificateExpiryMessage, getCertificateExpiryState } from "./git-provider-certificate";

const NOW = new Date("2026-07-19T00:00:00.000Z");

describe("git provider certificate expiry", () => {
  it("distinguishes expired, soon, valid, and unknown expiry", () => {
    expect(getCertificateExpiryState("2026-07-18T00:00:00.000Z", NOW)).toBe("expired");
    expect(getCertificateExpiryState("2026-08-01T00:00:00.000Z", NOW)).toBe("soon");
    expect(getCertificateExpiryState("2026-09-01T00:00:00.000Z", NOW)).toBe("valid");
    expect(getCertificateExpiryState(null, NOW)).toBe("unknown");
    expect(getCertificateExpiryState("not-a-date", NOW)).toBe("unknown");
  });

  it("provides clear user-facing expiry messages", () => {
    expect(getCertificateExpiryMessage(null, NOW)).toBe("Expiry unknown.");
    expect(getCertificateExpiryMessage("2026-07-18T00:00:00.000Z", NOW)).toContain("Expired on");
    expect(getCertificateExpiryMessage("2026-08-01T00:00:00.000Z", NOW)).toContain(
      "within 30 days"
    );
  });
});
