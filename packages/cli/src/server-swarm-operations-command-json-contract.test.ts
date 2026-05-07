import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { serverCommand } from "./commands/server";
import { captureCommandExecution } from "./login-test-helpers";

describe("server swarm operations CLI JSON contract", () => {
  test("node availability requires confirmation unless dry-run", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(serverCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "server",
        "ops",
        "swarm",
        "node",
        "availability",
        "--server",
        "srv_123",
        "--node",
        "worker-a",
        "--availability",
        "drain",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Set node worker-a availability to drain. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("service scale dry-run calls the server operation API", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(serverCommand());
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.DAOFLOW_URL;
    const originalToken = process.env.DAOFLOW_TOKEN;

    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toContain("/trpc/updateSwarmServiceScale");
      return new Response(
        JSON.stringify({
          result: {
            data: {
              status: "ok",
              operation: {
                id: "op_scale_plan",
                kind: "swarm_service_scale_plan",
                status: "completed",
                dryRun: true,
                summary: "Would scale Swarm service demo_web to 3 replicas."
              },
              result: {
                dryRun: true,
                command: "docker service scale demo_web=3",
                summary: "Would scale Swarm service demo_web to 3 replicas."
              }
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      );
    }) as unknown as typeof fetch;

    try {
      const result = await captureCommandExecution(async () => {
        await program.parseAsync([
          "node",
          "daoflow",
          "server",
          "ops",
          "swarm",
          "service",
          "scale",
          "--server",
          "srv_123",
          "--service",
          "demo_web",
          "--replicas",
          "3",
          "--dry-run",
          "--json"
        ]);
      });

      expect(result.exitCode).toBeNull();
      expect(JSON.parse(result.logs[0])).toMatchObject({
        ok: true,
        data: {
          status: "ok",
          operation: {
            kind: "swarm_service_scale_plan",
            dryRun: true
          }
        }
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
