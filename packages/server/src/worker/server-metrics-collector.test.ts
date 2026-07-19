import { describe, expect, test } from "vitest";
import { parseServerMetricsOutput } from "./server-metrics-collector";

describe("server-metrics-collector", () => {
  test("METRICS_SCRIPT parsing logic handles valid output", () => {
    const lines = [
      "CPU:23.5",
      "MEM:45.2:3.62:8.00",
      "DISK:61:50",
      "DOCKER_DISK:61:50",
      "NET:1024.50:512.25"
    ];

    const snapshot = parseServerMetricsOutput(lines);

    expect(snapshot.cpuPercent).toBe(23.5);
    expect(snapshot.memoryUsedPercent).toBe(45.2);
    expect(snapshot.memoryUsedGB).toBe(3.62);
    expect(snapshot.memoryTotalGB).toBe(8.0);
    expect(snapshot.diskUsedPercent).toBe(61);
    expect(snapshot.diskTotalGB).toBe(50);
    expect(snapshot.dockerDiskUsedPercent).toBe(61);
    expect(snapshot.dockerDiskTotalGB).toBe(50);
    expect(snapshot.networkInMB).toBe(1024.5);
    expect(snapshot.networkOutMB).toBe(512.25);
  });

  test("handles missing or malformed lines gracefully", () => {
    const lines = ["CPU:", "MEM:invalid:also:bad", "DISK:", "NET:"];

    const snapshot = parseServerMetricsOutput(lines);

    expect(snapshot.cpuPercent).toBe(0);
    expect(snapshot.memoryUsedPercent).toBe(0);
    expect(snapshot.diskUsedPercent).toBe(0);
    expect(snapshot.dockerDiskUsedPercent).toBeNull();
  });
});
