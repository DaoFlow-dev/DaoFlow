import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { logsCommand } from "./commands/logs";
import { maintenanceCommand } from "./commands/maintenance";
import { terminalCommand } from "./commands/terminal";
import { captureCommandExecution } from "./login-test-helpers";

async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const originalUrl = process.env.DAOFLOW_URL;
  const originalToken = process.env.DAOFLOW_TOKEN;
  const homeDir = mkdtempSync(join(tmpdir(), "daoflow-cli-home-"));

  delete process.env.DAOFLOW_URL;
  delete process.env.DAOFLOW_TOKEN;
  process.env.HOME = homeDir;

  try {
    return await run(homeDir);
  } finally {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

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

    rmSync(homeDir, { recursive: true, force: true });
  }
}

describe("live operations CLI JSON contract", () => {
  test("logs follow requires an explicit deployment or service target", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(logsCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync(["node", "daoflow", "logs", "--follow", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Use --deployment or --service-id with --follow.",
      code: "INVALID_INPUT"
    });
  });

  test("logs follow streams deployment events as JSON envelopes", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(logsCommand());
    const originalFetch = globalThis.fetch;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        expect(url).toContain("/api/v1/logs/stream/dep_123");
        return new Response(
          new ReadableStream({
            start(controller) {
              controller.enqueue(
                new TextEncoder().encode(
                  'data: {"id":1,"level":"info","message":"ready","source":"system","timestamp":"2026-03-20T12:00:00.000Z"}\n\n'
                )
              );
              controller.close();
            }
          }),
          { status: 200, headers: { "Content-Type": "text/event-stream" } }
        );
      }) as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "logs",
            "--deployment",
            "dep_123",
            "--follow",
            "--json"
          ]);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    expect(result.exitCode).toBeNull();
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        id: 1,
        timestamp: "2026-03-20T12:00:00.000Z",
        stream: "stdout",
        level: "info",
        source: "system",
        message: "ready"
      }
    });
  });

  test("maintenance run in JSON mode still requires --yes unless dry-run", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(maintenanceCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync(["node", "daoflow", "maintenance", "run", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Run operational maintenance cleanup. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("maintenance report returns the standard success envelope", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(maintenanceCommand());
    const originalFetch = globalThis.fetch;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";
      globalThis.fetch = ((input: RequestInfo | URL) => {
        const url =
          typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
        expect(url).toContain("/trpc/operationalMaintenanceReport");
        return new Response(
          JSON.stringify({
            result: {
              data: {
                generatedAt: "2026-03-20T12:00:00.000Z",
                defaults: {},
                current: {
                  stalledDeployments: { eligibleCount: 0, items: [] },
                  stalePreviews: { previewEnabledServices: 0, eligibleCount: 0, items: [] },
                  expiredCliAuthRequests: { eligibleCount: 0 },
                  retainedArtifacts: {
                    eligibleCount: 0,
                    retainedArtifacts: 0,
                    incompleteUploads: 0,
                    items: []
                  }
                },
                latestRun: null
              }
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        );
      }) as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync(["node", "daoflow", "maintenance", "report", "--json"]);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    expect(result.exitCode).toBeNull();
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        generatedAt: "2026-03-20T12:00:00.000Z",
        defaults: {},
        current: {
          stalledDeployments: { eligibleCount: 0, items: [] },
          stalePreviews: { previewEnabledServices: 0, eligibleCount: 0, items: [] },
          expiredCliAuthRequests: { eligibleCount: 0 },
          retainedArtifacts: {
            eligibleCount: 0,
            retainedArtifacts: 0,
            incompleteUploads: 0,
            items: []
          }
        },
        latestRun: null
      }
    });
  });

  test("terminal service reports missing terminal scope in JSON mode", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(terminalCommand());
    const originalFetch = globalThis.fetch;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "https://daoflow.test";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";
      globalThis.fetch = (() =>
        new Response(
          JSON.stringify({
            result: {
              data: {
                authz: {
                  capabilities: ["logs:read"]
                }
              }
            }
          }),
          { status: 200, headers: { "Content-Type": "application/json" } }
        )) as unknown as typeof fetch;

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "terminal",
            "service",
            "--service",
            "svc_123",
            "--json"
          ]);
        });
      } finally {
        globalThis.fetch = originalFetch;
      }
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Terminal access requires terminal:open.",
      code: "SCOPE_DENIED",
      requiredScope: "terminal:open",
      grantedScopes: ["logs:read"]
    });
  });
});
