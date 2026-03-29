import { describe, expect, it } from "vitest";
import { auditSinceWindowError, parseAuditSinceWindow } from "@daoflow/shared";

describe("audit since window helper", () => {
  it("computes cutoffs from valid durations", () => {
    const now = Date.UTC(2026, 2, 29, 12, 0, 0);

    expect(parseAuditSinceWindow("2h", now).toISOString()).toBe("2026-03-29T10:00:00.000Z");
    expect(parseAuditSinceWindow("3d", now).toISOString()).toBe("2026-03-26T12:00:00.000Z");
  });

  it("normalizes mixed-case input before computing the cutoff", () => {
    const now = Date.UTC(2026, 2, 29, 12, 0, 0);

    expect(parseAuditSinceWindow(" 1W ", now).toISOString()).toBe("2026-03-22T12:00:00.000Z");
  });

  it("throws the shared validation message for invalid durations", () => {
    expect(() => parseAuditSinceWindow("tomorrow")).toThrowError(auditSinceWindowError);
  });
});
