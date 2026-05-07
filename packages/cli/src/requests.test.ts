import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCommandExecution } from "./login-test-helpers";
import { runCli } from "./program";

const originalHome = process.env.HOME;
const originalUrl = process.env.DAOFLOW_URL;
const originalToken = process.env.DAOFLOW_TOKEN;
const originalFetch = globalThis.fetch;

describe("requests command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-requests-cli-"));
    process.env.HOME = homeDir;
    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    process.env.DAOFLOW_URL = originalUrl;
    process.env.DAOFLOW_TOKEN = originalToken;
    globalThis.fetch = originalFetch;
    rmSync(homeDir, { recursive: true, force: true });
  });

  test("requests returns the standard success envelope in JSON mode", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/requestAccessLogs");
      expect(url).toContain("failedAuth");
      expect(url).toContain("1h");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                summary: {
                  totalRequests: 2,
                  failedRequests: 0,
                  deniedRequests: 1,
                  apiTokenRequests: 1,
                  webhookRequests: 0,
                  slowRequests: 0
                },
                entries: [
                  {
                    id: "reqlog_1",
                    requestId: "req_123",
                    method: "GET",
                    path: "/api/v1/images",
                    category: "api",
                    statusCode: 403,
                    durationMs: 24,
                    outcome: "denied",
                    errorCategory: "scope_denied",
                    authMethod: "api-token",
                    actorType: "agent",
                    actorId: "agent_1",
                    actorEmail: "agent@daoflow.local",
                    actorRole: "agent",
                    tokenId: "tok_1",
                    tokenPrefix: "dfl_prefix",
                    sourceIp: "203.0.113.10",
                    userAgent: "daoflow-cli/0.7.0",
                    metadata: {},
                    createdAt: "2026-03-29T12:00:00.000Z",
                    actorLabel: "agent@daoflow.local",
                    tokenLabel: "dfl_prefix..."
                  }
                ]
              }
            }
          }),
          { headers: { "content-type": "application/json" } }
        )
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "requests", "--failed-auth", "--since", "1h", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        limit: 25,
        since: "1h",
        summary: {
          totalRequests: 2,
          failedRequests: 0,
          deniedRequests: 1,
          apiTokenRequests: 1,
          webhookRequests: 0,
          slowRequests: 0
        },
        entries: [
          {
            id: "reqlog_1",
            requestId: "req_123",
            method: "GET",
            path: "/api/v1/images",
            category: "api",
            statusCode: 403,
            durationMs: 24,
            outcome: "denied",
            errorCategory: "scope_denied",
            authMethod: "api-token",
            actorType: "agent",
            actorId: "agent_1",
            actorEmail: "agent@daoflow.local",
            actorRole: "agent",
            tokenId: "tok_1",
            tokenPrefix: "dfl_prefix",
            sourceIp: "203.0.113.10",
            userAgent: "daoflow-cli/0.7.0",
            metadata: {},
            createdAt: "2026-03-29T12:00:00.000Z",
            actorLabel: "agent@daoflow.local",
            tokenLabel: "dfl_prefix..."
          }
        ]
      }
    });
  });

  test("requests rejects invalid slow thresholds before any API call", async () => {
    globalThis.fetch = (() => {
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "requests", "--slow-ms", "0", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Slow threshold must be an integer between 1 and 120000 milliseconds.",
      code: "INVALID_INPUT"
    });
  });
});
