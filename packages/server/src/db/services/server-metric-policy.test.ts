import { describe, expect, it } from "vitest";
import { DEFAULT_SERVER_METRIC_POLICY, normalizeServerMetricPolicy } from "./server-metric-policy";

describe("server metric policy", () => {
  it("uses safe defaults with thresholds disabled", () => {
    expect(normalizeServerMetricPolicy()).toEqual(DEFAULT_SERVER_METRIC_POLICY);
    expect(DEFAULT_SERVER_METRIC_POLICY.cpuWarnPercent).toBe(0);
    expect(DEFAULT_SERVER_METRIC_POLICY.diskHardPercent).toBe(0);
  });

  it("accepts a complete bounded policy", () => {
    expect(
      normalizeServerMetricPolicy({
        sampleIntervalSeconds: 30,
        retentionDays: 14,
        cpuWarnPercent: 80,
        cpuHardPercent: 95,
        memoryWarnPercent: 80,
        memoryHardPercent: 95,
        diskWarnPercent: 75,
        diskHardPercent: 90,
        dockerDiskWarnPercent: 75,
        dockerDiskHardPercent: 90,
        cooldownMinutes: 15
      })
    ).toMatchObject({
      sampleIntervalSeconds: 30,
      retentionDays: 14,
      cpuWarnPercent: 80,
      cpuHardPercent: 95,
      cooldownMinutes: 15
    });
  });

  it("rejects reversed thresholds and out-of-range percentages", () => {
    expect(() => normalizeServerMetricPolicy({ cpuWarnPercent: 90, cpuHardPercent: 80 })).toThrow(
      "cpu warning threshold cannot exceed its hard threshold"
    );
    expect(() => normalizeServerMetricPolicy({ diskHardPercent: 101 })).toThrow(
      "diskHardPercent must be a whole number between 0 and 100"
    );
  });
});
