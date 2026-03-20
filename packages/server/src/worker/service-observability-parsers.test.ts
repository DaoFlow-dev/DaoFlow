import { describe, expect, it, vi } from "vitest";
import {
  formatUptime,
  parseDockerPsLines,
  parseDockerStateLines,
  parseDockerStatsLines
} from "./service-observability-parsers";

describe("service observability parsers", () => {
  it("parses docker stats JSON output into normalized MB-based metrics", () => {
    const stats = parseDockerStatsLines([
      JSON.stringify({
        CPUPerc: "12.5%",
        MemUsage: "512MiB / 2GiB",
        NetIO: "1.5GB / 256MB",
        BlockIO: "10kB / 3MiB",
        PIDs: "14"
      })
    ]);

    expect(stats).toEqual([
      {
        cpuPercent: 12.5,
        memoryUsageMB: 512,
        memoryLimitMB: 2048,
        networkRxMB: 1500,
        networkTxMB: 256,
        blockReadMB: 0.01,
        blockWriteMB: 3,
        pids: 14
      }
    ]);
  });

  it("parses docker ps and inspect output for runtime identity and state", () => {
    expect(
      parseDockerPsLines([
        JSON.stringify({
          ID: "ctr_123",
          Names: "demo-api-1",
          State: "running",
          Status: "Up 10 seconds"
        })
      ])
    ).toEqual([
      {
        id: "ctr_123",
        name: "demo-api-1",
        state: "running",
        status: "Up 10 seconds"
      }
    ]);

    expect(
      parseDockerStateLines([
        JSON.stringify({
          StartedAt: "2026-03-19T18:00:00.000000000Z",
          RestartCount: 2,
          Running: true
        })
      ])
    ).toEqual([
      {
        startedAt: "2026-03-19T18:00:00.000000000Z",
        restartCount: 2,
        running: true
      }
    ]);
  });

  it("formats uptime from the oldest started container", () => {
    const dateNowSpy = vi
      .spyOn(Date, "now")
      .mockReturnValue(new Date("2026-03-19T20:15:00.000Z").getTime());

    expect(formatUptime(["2026-03-19T20:10:30.000Z", "2026-03-19T19:00:00.000Z", null])).toBe(
      "1h 15m"
    );

    dateNowSpy.mockRestore();
  });
});
