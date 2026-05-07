import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { requestAccessLogs } from "../schema/request-access-logs";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import {
  countPrunableRequestAccessLogs,
  listRequestAccessLogs,
  pruneRequestAccessLogs,
  recordRequestAccessLog
} from "./request-access-logs";

describe("request access logs", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("persists redacted request metadata without query strings or secrets", async () => {
    await recordRequestAccessLog({
      requestId: "req-access-1",
      method: "POST",
      url: "https://daoflow.test/api/webhooks/github?token=secret&password=hidden",
      statusCode: 401,
      durationMs: 42.8,
      sourceIp: "203.0.113.10",
      userAgent: "curl/8",
      attribution: {
        authMethod: null,
        actorType: null,
        actorId: null,
        actorEmail: null,
        actorRole: null,
        tokenId: null,
        tokenName: null,
        tokenPrefix: null,
        requiredScopes: ["deploy:start"],
        grantedScopes: [],
        errorCategory: "AUTH_REQUIRED"
      }
    });

    const [row] = await db
      .select()
      .from(requestAccessLogs)
      .where(eq(requestAccessLogs.requestId, "req-access-1"));

    expect(row).toMatchObject({
      method: "POST",
      path: "/api/webhooks/github",
      category: "webhook",
      statusCode: 401,
      outcome: "failed_auth",
      sourceIp: "203.0.113.10",
      userAgent: "curl/8",
      errorCategory: "AUTH_REQUIRED",
      requiredScopes: "deploy:start"
    });
    expect(JSON.stringify(row)).not.toContain("secret");
    expect(JSON.stringify(row)).not.toContain("password");
  });

  it("filters, summarizes, paginates, and prunes by retention", async () => {
    const now = new Date("2026-05-06T12:00:00.000Z");
    await recordRequestAccessLog({
      requestId: "req-token-denied",
      method: "GET",
      url: "https://daoflow.test/trpc/deploymentLogs",
      statusCode: 403,
      durationMs: 1500,
      sourceIp: "198.51.100.20",
      userAgent: "daoflow-cli/0.8.6",
      now,
      attribution: {
        authMethod: "api-token",
        actorType: "agent",
        actorId: "principal_agent",
        actorEmail: "agent@token.daoflow.local",
        actorRole: "agent",
        tokenId: "tok_agent",
        tokenName: "agent-token",
        tokenPrefix: "dfl_agent_1",
        requiredScopes: ["deploy:start"],
        grantedScopes: ["logs:read"],
        errorCategory: "SCOPE_DENIED"
      }
    });
    await recordRequestAccessLog({
      requestId: "req-old",
      method: "GET",
      url: "https://daoflow.test/health",
      statusCode: 200,
      durationMs: 3,
      sourceIp: "127.0.0.1",
      userAgent: null,
      now: new Date("2026-03-01T12:00:00.000Z"),
      attribution: null
    });

    const filtered = await listRequestAccessLogs({
      limit: 1,
      status: "denied",
      tokenId: "tok_agent",
      minDurationMs: 1000
    });

    expect(filtered.summary).toMatchObject({
      totalEntries: 1,
      deniedScopes: 1,
      apiTokenRequests: 1,
      slowRequests: 1
    });
    expect(filtered.entries).toHaveLength(1);
    expect(filtered.entries[0]).toMatchObject({
      requestId: "req-token-denied",
      tokenPrefix: "dfl_agent_1",
      requiredScopes: ["deploy:start"],
      grantedScopes: ["logs:read"]
    });

    expect(await countPrunableRequestAccessLogs(now)).toBe(1);
    expect(await pruneRequestAccessLogs(now)).toBe(1);
    expect(
      (await listRequestAccessLogs({ limit: 10 })).entries.map((entry) => entry.requestId)
    ).toEqual(["req-token-denied"]);
  });
});
