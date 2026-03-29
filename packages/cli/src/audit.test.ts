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

describe("audit command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-audit-cli-"));
    process.env.HOME = homeDir;
    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
  });

  afterEach(() => {
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

    globalThis.fetch = originalFetch;
    rmSync(homeDir, { recursive: true, force: true });
  });

  test("audit returns the standard success envelope in JSON mode", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/auditTrail");
      expect(url).toContain("20");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                summary: {
                  totalEntries: 42,
                  deploymentActions: 12,
                  executionActions: 18,
                  backupActions: 4,
                  humanEntries: 9
                },
                entries: [
                  {
                    id: "audit_123",
                    actorType: "user",
                    actorId: "user_123",
                    actorEmail: "owner@daoflow.local",
                    actorRole: "owner",
                    organizationId: "org_123",
                    targetResource: "deployment/dep_123",
                    action: "deployment.created",
                    inputSummary: "Queued deployment for web.",
                    permissionScope: "deploy:start",
                    outcome: "success",
                    metadata: {
                      resourceType: "deployment",
                      resourceId: "dep_123"
                    },
                    createdAt: "2026-03-29T12:00:00.000Z",
                    actorLabel: "owner@daoflow.local",
                    resourceType: "deployment",
                    resourceId: "dep_123",
                    resourceLabel: "deployment/dep_123",
                    statusTone: "healthy",
                    detail: "Queued deployment for web."
                  }
                ]
              }
            }
          }),
          {
            headers: { "content-type": "application/json" }
          }
        )
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "audit", "--limit", "20", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        limit: 20,
        since: null,
        summary: {
          totalEntries: 42,
          deploymentActions: 12,
          executionActions: 18,
          backupActions: 4,
          humanEntries: 9
        },
        entries: [
          {
            id: "audit_123",
            actorType: "user",
            actorId: "user_123",
            actorEmail: "owner@daoflow.local",
            actorRole: "owner",
            organizationId: "org_123",
            targetResource: "deployment/dep_123",
            action: "deployment.created",
            inputSummary: "Queued deployment for web.",
            permissionScope: "deploy:start",
            outcome: "success",
            metadata: {
              resourceType: "deployment",
              resourceId: "dep_123"
            },
            createdAt: "2026-03-29T12:00:00.000Z",
            actorLabel: "owner@daoflow.local",
            resourceType: "deployment",
            resourceId: "dep_123",
            resourceLabel: "deployment/dep_123",
            statusTone: "healthy",
            detail: "Queued deployment for web."
          }
        ]
      }
    });
  });

  test("audit forwards a valid since window in JSON mode", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/auditTrail");
      expect(url).toContain("1h");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                summary: {
                  totalEntries: 3,
                  deploymentActions: 1,
                  executionActions: 1,
                  backupActions: 0,
                  humanEntries: 2
                },
                entries: []
              }
            }
          }),
          {
            headers: { "content-type": "application/json" }
          }
        )
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "audit", "--since", "1h", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        limit: 12,
        since: "1h",
        summary: {
          totalEntries: 3,
          deploymentActions: 1,
          executionActions: 1,
          backupActions: 0,
          humanEntries: 2
        },
        entries: []
      }
    });
  });

  test("audit rejects invalid limits before any API call", async () => {
    globalThis.fetch = (() => {
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "audit", "--limit", "0", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Limit must be an integer between 1 and 50.",
      code: "INVALID_INPUT"
    });
  });

  test("audit rejects invalid since windows before any API call", async () => {
    globalThis.fetch = (() => {
      throw new Error("fetch should not be called");
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "audit", "--since", "tomorrow", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Since must be a positive duration like 15m, 1h, 7d, or 2w.",
      code: "INVALID_INPUT"
    });
  });

  test("audit preserves API error messages in JSON mode", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message: "Authentication required",
              code: -32001,
              data: {
                code: "UNAUTHORIZED",
                httpStatus: 401,
                path: "auditTrail"
              }
            }
          }),
          {
            status: 401,
            headers: { "content-type": "application/json" }
          }
        )
      )) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "audit", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Authentication required",
      code: "ERROR"
    });
  });
});
