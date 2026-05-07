import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { serverCommand } from "./commands/server";
import { captureCommandExecution } from "./login-test-helpers";

describe("server operations CLI JSON contract", () => {
  test("server ops logs returns the standard success envelope", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(serverCommand());
    const originalFetch = globalThis.fetch;
    const originalUrl = process.env.DAOFLOW_URL;
    const originalToken = process.env.DAOFLOW_TOKEN;

    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
    globalThis.fetch = (() =>
      new Response(
        JSON.stringify({
          result: {
            data: {
              operation: {
                id: "op_123",
                serverId: "srv_123",
                status: "completed",
                permissionScope: "server:write",
                summary: "Previewed cleanup."
              },
              logs: [{ id: 1, stream: "info", message: "Previewed cleanup." }]
            }
          }
        }),
        { status: 200, headers: { "Content-Type": "application/json" } }
      )) as unknown as typeof fetch;

    try {
      const result = await captureCommandExecution(async () => {
        await program.parseAsync([
          "node",
          "daoflow",
          "server",
          "ops",
          "logs",
          "--operation",
          "op_123",
          "--json"
        ]);
      });

      expect(result.exitCode).toBeNull();
      expect(JSON.parse(result.logs[0])).toEqual({
        ok: true,
        data: {
          operation: {
            id: "op_123",
            serverId: "srv_123",
            status: "completed",
            permissionScope: "server:write",
            summary: "Previewed cleanup."
          },
          logs: [{ id: 1, stream: "info", message: "Previewed cleanup." }]
        }
      });
    } finally {
      globalThis.fetch = originalFetch;
      if (originalUrl) {
        process.env.DAOFLOW_URL = originalUrl;
      } else {
        delete process.env.DAOFLOW_URL;
      }
      if (originalToken) {
        process.env.DAOFLOW_TOKEN = originalToken;
      } else {
        delete process.env.DAOFLOW_TOKEN;
      }
    }
  });
});
