import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { serverMetricsCommand } from "./commands/server-metrics";
import { captureCommandExecution } from "./login-test-helpers";

function requestUrl(input: string | URL | Request) {
  return input instanceof Request ? input.url : input.toString();
}

describe("server metrics CLI JSON contract", () => {
  test("preserves the default latest-snapshot JSON shape", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(serverMetricsCommand());
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.DAOFLOW_URL;
    const originalToken = process.env.DAOFLOW_TOKEN;
    const snapshot = {
      cpuPercent: 20,
      memoryUsedPercent: 50,
      memoryUsedGB: 4,
      memoryTotalGB: 8,
      diskUsedPercent: 60,
      diskTotalGB: 100,
      dockerDiskUsedPercent: 30,
      dockerDiskTotalGB: 20,
      networkInMB: 10,
      networkOutMB: 5
    };

    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
    globalThis.fetch = ((input: string | URL | Request) => {
      expect(requestUrl(input)).toContain("/api/v1/server-metrics/srv_123");
      expect(requestUrl(input)).not.toContain("monitoring=true");
      return Promise.resolve(
        new Response(JSON.stringify(snapshot), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }) as typeof fetch;

    try {
      const result = await captureCommandExecution(async () => {
        await program.parseAsync([
          "node",
          "daoflow",
          "server-metrics",
          "--server",
          "srv_123",
          "--json"
        ]);
      });

      expect(result.exitCode).toBeNull();
      expect(JSON.parse(result.logs[0])).toEqual({ ok: true, data: snapshot });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl) process.env.DAOFLOW_URL = originalUrl;
      else delete process.env.DAOFLOW_URL;
      if (originalToken) process.env.DAOFLOW_TOKEN = originalToken;
      else delete process.env.DAOFLOW_TOKEN;
    }
  });

  test("returns monitoring state, policy, and history in the standard success envelope", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(serverMetricsCommand());
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.DAOFLOW_URL;
    const originalToken = process.env.DAOFLOW_TOKEN;

    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
    const response = {
      serverId: "srv_123",
      policy: {
        sampleIntervalSeconds: 60,
        retentionDays: 7,
        cpuWarnPercent: 85,
        cpuHardPercent: 95,
        memoryWarnPercent: 85,
        memoryHardPercent: 95,
        diskWarnPercent: 80,
        diskHardPercent: 92,
        dockerDiskWarnPercent: 80,
        dockerDiskHardPercent: 92,
        cooldownMinutes: 30
      },
      state: {
        status: "warning",
        metric: "disk",
        measuredValue: 83,
        threshold: 80,
        changedAt: "2026-07-19T04:00:00.000Z",
        lastAlertedAt: "2026-07-19T04:00:00.000Z",
        error: null
      },
      latest: {
        id: "metric_1",
        serverId: "srv_123",
        cpuPercent: 20,
        memoryUsedPercent: 50,
        memoryUsedGB: 4,
        memoryTotalGB: 8,
        diskUsedPercent: 83,
        diskTotalGB: 100,
        dockerDiskUsedPercent: 30,
        dockerDiskTotalGB: 20,
        networkInMB: 10,
        networkOutMB: 5,
        collectedAt: "2026-07-19T04:00:00.000Z"
      },
      history: []
    };

    globalThis.fetch = ((input: string | URL | Request) => {
      expect(requestUrl(input)).toContain(
        "/api/v1/server-metrics/srv_123?monitoring=true&since=24h&limit=60"
      );
      return Promise.resolve(
        new Response(JSON.stringify(response), {
          status: 200,
          headers: { "Content-Type": "application/json" }
        })
      );
    }) as typeof fetch;

    try {
      const result = await captureCommandExecution(async () => {
        await program.parseAsync([
          "node",
          "daoflow",
          "server-metrics",
          "--server",
          "srv_123",
          "--monitoring",
          "--json"
        ]);
      });

      expect(result.exitCode).toBeNull();
      expect(JSON.parse(result.logs[0])).toEqual({ ok: true, data: response });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl) process.env.DAOFLOW_URL = originalUrl;
      else delete process.env.DAOFLOW_URL;
      if (originalToken) process.env.DAOFLOW_TOKEN = originalToken;
      else delete process.env.DAOFLOW_TOKEN;
    }
  });

  test("rejects an invalid history window before contacting the server", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(serverMetricsCommand());
    const originalUrl = process.env.DAOFLOW_URL;
    const originalToken = process.env.DAOFLOW_TOKEN;
    const originalFetch = globalThis.fetch;
    let fetched = false;

    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
    globalThis.fetch = (() => {
      fetched = true;
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch;

    try {
      const result = await captureCommandExecution(async () => {
        await program.parseAsync([
          "node",
          "daoflow",
          "server-metrics",
          "--server",
          "srv_123",
          "--monitoring",
          "--since",
          "yesterday",
          "--json"
        ]);
      });

      expect(result.exitCode).toBe(1);
      expect(fetched).toBe(false);
      expect(JSON.parse(result.logs[0])).toMatchObject({
        ok: false,
        code: "INVALID_INPUT",
        error: "History window must use a positive value followed by m, h, d, or w."
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl) process.env.DAOFLOW_URL = originalUrl;
      else delete process.env.DAOFLOW_URL;
      if (originalToken) process.env.DAOFLOW_TOKEN = originalToken;
      else delete process.env.DAOFLOW_TOKEN;
    }
  });
});
