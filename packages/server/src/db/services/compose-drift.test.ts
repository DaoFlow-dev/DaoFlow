import { describe, expect, it } from "vitest";
import {
  composeDriftLiveInspectionContract,
  normalizeStoredComposeDriftSnapshot
} from "./compose-drift";

describe("compose drift containment", () => {
  it("never treats a legacy aligned record as live or authoritative", () => {
    const snapshot = normalizeStoredComposeDriftSnapshot({
      status: "aligned",
      lastCheckedAt: "2026-07-18T10:00:00.000Z",
      summary: "The old read model said this service was aligned.",
      actualImageReference: "ghcr.io/example/api:stable"
    });

    expect(snapshot).toMatchObject({
      source: "cached-snapshot",
      authoritative: false,
      status: "unavailable",
      statusLabel: "Cached snapshot cannot confirm alignment",
      attemptedAt: "2026-07-18T10:00:00.000Z",
      observedAt: "2026-07-18T10:00:00.000Z",
      maxAgeSeconds: 900
    });
    expect(snapshot.summary).toMatch(/cannot verify current runtime alignment/i);
  });

  it("marks missing stored observations unavailable without inventing a host check", () => {
    const snapshot = normalizeStoredComposeDriftSnapshot(undefined);

    expect(snapshot).toMatchObject({
      source: "unavailable",
      authoritative: false,
      status: "unavailable",
      attemptedAt: null,
      observedAt: null
    });
  });

  it("reserves bounded, redacted collection rules for the later live phase", () => {
    expect(composeDriftLiveInspectionContract).toMatchObject({
      availability: "not-implemented",
      limits: {
        minimumIntervalSeconds: 60,
        maxConcurrentPerServer: 1
      }
    });
    expect(composeDriftLiveInspectionContract.blockers).toEqual(
      expect.arrayContaining([
        "#230 strict SSH host identity",
        "#233 DaoFlow-owned resource selection"
      ])
    );
    expect(composeDriftLiveInspectionContract.persistence.forbidden).toContain(
      "raw-docker-inspect-output"
    );
  });
});
