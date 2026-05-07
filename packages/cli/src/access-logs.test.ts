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

describe("access-logs command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-access-logs-cli-"));
    process.env.HOME = homeDir;
    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
  });

  afterEach(() => {
    if (originalHome) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalUrl) process.env.DAOFLOW_URL = originalUrl;
    else delete process.env.DAOFLOW_URL;
    if (originalToken) process.env.DAOFLOW_TOKEN = originalToken;
    else delete process.env.DAOFLOW_TOKEN;
    globalThis.fetch = originalFetch;
    rmSync(homeDir, { recursive: true, force: true });
  });

  test("returns the standard success envelope in JSON mode", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
      expect(url).toContain("/trpc/accessLogs");
      expect(url).toContain("failed-auth");
      expect(url).toContain("%2Fapi%2Fwebhooks%2F");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                limit: 25,
                cursor: null,
                nextCursor: null,
                filters: {
                  status: "failed-auth",
                  method: null,
                  path: "/api/webhooks/*",
                  actorType: null,
                  tokenId: null,
                  requestId: null,
                  since: "1h",
                  search: null,
                  minDurationMs: 1000
                },
                summary: {
                  totalEntries: 1,
                  failedAuth: 1,
                  deniedScopes: 0,
                  webhookRequests: 1,
                  apiTokenRequests: 0,
                  slowRequests: 1,
                  errorResponses: 0
                },
                retentionDays: 30,
                entries: [
                  {
                    id: "rlog_123",
                    requestId: "req-abc123",
                    method: "POST",
                    path: "/api/webhooks/github",
                    category: "webhook",
                    statusCode: 401,
                    outcome: "failed_auth",
                    durationMs: 1200,
                    authMethod: null,
                    actorType: null,
                    actorId: null,
                    actorEmail: null,
                    actorRole: null,
                    tokenId: null,
                    tokenName: null,
                    tokenPrefix: null,
                    requiredScopes: [],
                    grantedScopes: [],
                    sourceIp: "203.0.113.10",
                    userAgent: "curl/8",
                    errorCategory: "AUTH_REQUIRED",
                    metadata: null,
                    createdAt: "2026-05-06T18:00:00.000Z"
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
      await runCli([
        "node",
        "daoflow",
        "access-logs",
        "--limit",
        "25",
        "--since",
        "1h",
        "--status",
        "failed-auth",
        "--path",
        "/api/webhooks/*",
        "--min-duration-ms",
        "1000",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: true,
      data: {
        limit: 25,
        summary: { failedAuth: 1 },
        entries: [{ id: "rlog_123", errorCategory: "AUTH_REQUIRED" }]
      }
    });
  });

  test("rejects invalid status before any API call", async () => {
    let called = false;
    globalThis.fetch = (() => {
      called = true;
      return Promise.resolve(new Response("{}"));
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "access-logs", "--status", "unknown", "--json"]);
    });

    expect(called).toBe(false);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Status must be one of: failed-auth, denied, error, slow, webhook, api-token.",
      code: "INVALID_INPUT"
    });
  });
});
