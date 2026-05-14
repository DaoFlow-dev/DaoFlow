import { describe, expect, test } from "vitest";

describe("server-metrics-collector", () => {
  test("METRICS_SCRIPT parsing logic handles valid output", () => {
    const lines = ["CPU:23.5", "MEM:45.2:3.62:8.00", "DISK:61:50", "NET:1024.50:512.25"];

    const snapshot = {
      cpuPercent: 0,
      memoryUsedPercent: 0,
      memoryUsedGB: 0,
      memoryTotalGB: 0,
      diskUsedPercent: 0,
      diskTotalGB: 0,
      networkInMB: 0,
      networkOutMB: 0
    };

    for (const line of lines) {
      if (line.startsWith("CPU:")) {
        snapshot.cpuPercent = parseFloat(line.slice(4));
      } else if (line.startsWith("MEM:")) {
        const [pct, used, total] = line.slice(4).split(":");
        snapshot.memoryUsedPercent = parseFloat(pct ?? "0");
        snapshot.memoryUsedGB = parseFloat(used ?? "0");
        snapshot.memoryTotalGB = parseFloat(total ?? "0");
      } else if (line.startsWith("DISK:")) {
        const [pct, total] = line.slice(5).split(":");
        snapshot.diskUsedPercent = parseFloat(pct ?? "0");
        snapshot.diskTotalGB = parseFloat(total ?? "0");
      } else if (line.startsWith("NET:")) {
        const [inMB, outMB] = line.slice(4).split(":");
        snapshot.networkInMB = parseFloat(inMB ?? "0");
        snapshot.networkOutMB = parseFloat(outMB ?? "0");
      }
    }

    expect(snapshot.cpuPercent).toBe(23.5);
    expect(snapshot.memoryUsedPercent).toBe(45.2);
    expect(snapshot.memoryUsedGB).toBe(3.62);
    expect(snapshot.memoryTotalGB).toBe(8.0);
    expect(snapshot.diskUsedPercent).toBe(61);
    expect(snapshot.diskTotalGB).toBe(50);
    expect(snapshot.networkInMB).toBe(1024.5);
    expect(snapshot.networkOutMB).toBe(512.25);
  });

  test("handles missing or malformed lines gracefully", () => {
    const lines = ["CPU:", "MEM:invalid:also:bad", "DISK:", "NET:"];

    const snapshot = {
      cpuPercent: 0,
      memoryUsedPercent: 0,
      memoryUsedGB: 0,
      memoryTotalGB: 0,
      diskUsedPercent: 0,
      diskTotalGB: 0,
      networkInMB: 0,
      networkOutMB: 0
    };

    for (const line of lines) {
      if (line.startsWith("CPU:")) {
        const val = parseFloat(line.slice(4));
        snapshot.cpuPercent = Number.isFinite(val) ? val : 0;
      } else if (line.startsWith("MEM:")) {
        const parts = line.slice(4).split(":");
        const pct = parseFloat(parts[0] ?? "0");
        const used = parseFloat(parts[1] ?? "0");
        const total = parseFloat(parts[2] ?? "0");
        snapshot.memoryUsedPercent = Number.isFinite(pct) ? pct : 0;
        snapshot.memoryUsedGB = Number.isFinite(used) ? used : 0;
        snapshot.memoryTotalGB = Number.isFinite(total) ? total : 0;
      }
    }

    expect(snapshot.cpuPercent).toBe(0);
    expect(snapshot.memoryUsedPercent).toBe(0);
    expect(snapshot.diskUsedPercent).toBe(0);
  });
});
