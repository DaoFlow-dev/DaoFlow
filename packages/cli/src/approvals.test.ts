import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCommandExecution } from "./login-test-helpers";
import { createProgram, runCli } from "./program";

const originalHome = process.env.HOME;
const originalUrl = process.env.DAOFLOW_URL;
const originalToken = process.env.DAOFLOW_TOKEN;
const originalFetch = globalThis.fetch;

describe("approvals command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-approvals-cli-"));
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

  test("approvals list returns the standard success envelope in JSON mode", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/approvalQueue");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                summary: {
                  totalRequests: 1,
                  pendingRequests: 1,
                  approvedRequests: 0,
                  rejectedRequests: 0,
                  criticalRequests: 1
                },
                requests: [
                  {
                    id: "apr_123",
                    actionType: "backup-restore",
                    targetResource: "backup-run/bkr_123",
                    reason: "Restore after failed migration.",
                    status: "pending",
                    requestedByUserId: "usr_123",
                    requestedByEmail: "agent@daoflow.local",
                    requestedByRole: "agent",
                    resolvedByUserId: null,
                    resolvedByEmail: null,
                    inputSummary: {
                      riskLevel: "critical"
                    },
                    createdAt: "2026-03-29T12:00:00.000Z",
                    resolvedAt: null,
                    requestedBy: "agent@daoflow.local",
                    resourceLabel: "postgres-volume@production-us-west",
                    riskLevel: "critical",
                    statusTone: "failed",
                    commandSummary:
                      "Restore backup artifact to foundation-vps-1:/var/lib/postgresql/data.",
                    requestedAt: "2026-03-29T12:00:00.000Z",
                    expiresAt: "2026-03-29T19:00:00.000Z",
                    decidedBy: null,
                    decidedAt: null,
                    recommendedChecks: [
                      "Confirm the target volume is isolated from live writes before replaying snapshot data."
                    ]
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
      await runCli(["node", "daoflow", "approvals", "list", "--limit", "10", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        limit: 10,
        summary: {
          totalRequests: 1,
          pendingRequests: 1,
          approvedRequests: 0,
          rejectedRequests: 0,
          criticalRequests: 1
        },
        requests: [
          {
            id: "apr_123",
            actionType: "backup-restore",
            targetResource: "backup-run/bkr_123",
            reason: "Restore after failed migration.",
            status: "pending",
            requestedByUserId: "usr_123",
            requestedByEmail: "agent@daoflow.local",
            requestedByRole: "agent",
            resolvedByUserId: null,
            resolvedByEmail: null,
            inputSummary: {
              riskLevel: "critical"
            },
            createdAt: "2026-03-29T12:00:00.000Z",
            resolvedAt: null,
            requestedBy: "agent@daoflow.local",
            resourceLabel: "postgres-volume@production-us-west",
            riskLevel: "critical",
            statusTone: "failed",
            commandSummary: "Restore backup artifact to foundation-vps-1:/var/lib/postgresql/data.",
            requestedAt: "2026-03-29T12:00:00.000Z",
            expiresAt: "2026-03-29T19:00:00.000Z",
            decidedBy: null,
            decidedAt: null,
            recommendedChecks: [
              "Confirm the target volume is isolated from live writes before replaying snapshot data."
            ]
          }
        ]
      }
    });
  });

  test("approvals approve in JSON mode still requires --yes", async () => {
    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "approvals", "approve", "--request", "apr_123", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Approve a queued approval request apr_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("approvals reject in JSON mode still requires --yes", async () => {
    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "approvals", "reject", "--request", "apr_123", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Reject a queued approval request apr_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("approvals approve returns the decided request in JSON mode", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/approveApprovalRequest");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                id: "apr_123",
                actionType: "backup-restore",
                targetResource: "backup-run/bkr_123",
                reason: "Restore after failed migration.",
                status: "approved",
                requestedByUserId: "usr_123",
                requestedByEmail: "agent@daoflow.local",
                requestedByRole: "agent",
                resolvedByUserId: "usr_ops",
                resolvedByEmail: "ops@daoflow.local",
                inputSummary: null,
                createdAt: "2026-03-29T12:00:00.000Z",
                resolvedAt: "2026-03-29T12:30:00.000Z",
                requestedBy: "agent@daoflow.local",
                resourceLabel: "postgres-volume@production-us-west",
                riskLevel: "critical",
                statusTone: "healthy",
                commandSummary:
                  "Restore backup artifact to foundation-vps-1:/var/lib/postgresql/data.",
                requestedAt: "2026-03-29T12:00:00.000Z",
                expiresAt: "2026-03-29T19:00:00.000Z",
                decidedBy: "ops@daoflow.local",
                decidedAt: "2026-03-29T12:30:00.000Z",
                recommendedChecks: []
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
      await runCli([
        "node",
        "daoflow",
        "approvals",
        "approve",
        "--request",
        "apr_123",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        request: {
          id: "apr_123",
          actionType: "backup-restore",
          targetResource: "backup-run/bkr_123",
          reason: "Restore after failed migration.",
          status: "approved",
          requestedByUserId: "usr_123",
          requestedByEmail: "agent@daoflow.local",
          requestedByRole: "agent",
          resolvedByUserId: "usr_ops",
          resolvedByEmail: "ops@daoflow.local",
          inputSummary: null,
          createdAt: "2026-03-29T12:00:00.000Z",
          resolvedAt: "2026-03-29T12:30:00.000Z",
          requestedBy: "agent@daoflow.local",
          resourceLabel: "postgres-volume@production-us-west",
          riskLevel: "critical",
          statusTone: "healthy",
          commandSummary: "Restore backup artifact to foundation-vps-1:/var/lib/postgresql/data.",
          requestedAt: "2026-03-29T12:00:00.000Z",
          expiresAt: "2026-03-29T19:00:00.000Z",
          decidedBy: "ops@daoflow.local",
          decidedAt: "2026-03-29T12:30:00.000Z",
          recommendedChecks: []
        }
      }
    });
  });

  test("approvals reject returns the decided request in JSON mode", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/rejectApprovalRequest");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                id: "apr_456",
                actionType: "compose-release",
                targetResource: "compose-service/svc_api",
                reason: "Hold release until smoke checks complete.",
                status: "rejected",
                requestedByUserId: "usr_123",
                requestedByEmail: "agent@daoflow.local",
                requestedByRole: "agent",
                resolvedByUserId: "usr_ops",
                resolvedByEmail: "ops@daoflow.local",
                inputSummary: null,
                createdAt: "2026-03-29T12:00:00.000Z",
                resolvedAt: "2026-03-29T12:30:00.000Z",
                requestedBy: "agent@daoflow.local",
                resourceLabel: "api@production",
                riskLevel: "elevated",
                statusTone: "failed",
                commandSummary:
                  "Release ghcr.io/acme/api:1.4.2 for api on prod-web-1 using commit abcdef1.",
                requestedAt: "2026-03-29T12:00:00.000Z",
                expiresAt: "2026-03-29T16:00:00.000Z",
                decidedBy: "ops@daoflow.local",
                decidedAt: "2026-03-29T12:30:00.000Z",
                recommendedChecks: []
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
      await createProgram().parseAsync([
        "node",
        "daoflow",
        "approvals",
        "reject",
        "--request",
        "apr_456",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        request: {
          id: "apr_456",
          actionType: "compose-release",
          targetResource: "compose-service/svc_api",
          reason: "Hold release until smoke checks complete.",
          status: "rejected",
          requestedByUserId: "usr_123",
          requestedByEmail: "agent@daoflow.local",
          requestedByRole: "agent",
          resolvedByUserId: "usr_ops",
          resolvedByEmail: "ops@daoflow.local",
          inputSummary: null,
          createdAt: "2026-03-29T12:00:00.000Z",
          resolvedAt: "2026-03-29T12:30:00.000Z",
          requestedBy: "agent@daoflow.local",
          resourceLabel: "api@production",
          riskLevel: "elevated",
          statusTone: "failed",
          commandSummary:
            "Release ghcr.io/acme/api:1.4.2 for api on prod-web-1 using commit abcdef1.",
          requestedAt: "2026-03-29T12:00:00.000Z",
          expiresAt: "2026-03-29T16:00:00.000Z",
          decidedBy: "ops@daoflow.local",
          decidedAt: "2026-03-29T12:30:00.000Z",
          recommendedChecks: []
        }
      }
    });
  });

  test("approvals approve preserves exact missing-scope details in JSON mode", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            error: {
              message: "Missing required scope(s): approvals:decide",
              code: -32003,
              data: {
                code: "FORBIDDEN",
                httpStatus: 403,
                path: "approveApprovalRequest",
                cause: {
                  code: "SCOPE_DENIED",
                  requiredScopes: ["approvals:decide"],
                  grantedScopes: ["approvals:create"]
                }
              }
            }
          }),
          {
            status: 403,
            headers: { "content-type": "application/json" }
          }
        )
      )) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "approvals",
        "approve",
        "--request",
        "apr_123",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(2);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Missing required scope(s): approvals:decide",
      code: "SCOPE_DENIED",
      requiredScopes: ["approvals:decide"],
      grantedScopes: ["approvals:create"]
    });
  });
});
