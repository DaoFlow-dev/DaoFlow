import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { requestAccessLogs } from "../schema/request-access-logs";
import { resetTestDatabase } from "../../test-db";
import {
  listRequestAccessLogs,
  pruneRequestAccessLogs,
  recordRequestAccessLog
} from "./request-access-logs";

describe("request access logs service", () => {
  beforeEach(async () => {
    await resetTestDatabase();
  });

  it("records redacted paths and token attribution without request bodies or secrets", async () => {
    await recordRequestAccessLog({
      requestId: "req_123",
      method: "get",
      url: "https://control.daoflow.local/api/v1/images?token=secret&password=hidden",
      statusCode: 200,
      durationMs: 42.4,
      authMethod: "api-token",
      actorType: "agent",
      actorId: "principal_agent",
      actorEmail: "agent@token.daoflow.local",
      actorRole: "agent",
      tokenId: null,
      tokenPrefix: "dfl_prefix12",
      sourceIp: "203.0.113.10",
      userAgent: "daoflow-cli/0.7.0"
    });

    const rows = await db.select().from(requestAccessLogs);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      requestId: "req_123",
      method: "GET",
      path: "/api/v1/images",
      category: "api",
      outcome: "success",
      tokenPrefix: "dfl_prefix12",
      sourceIp: "203.0.113.10"
    });
    expect(JSON.stringify(rows[0])).not.toContain("secret");
    expect(JSON.stringify(rows[0])).not.toContain("hidden");
  });

  it("filters failed auth, webhook, token, and slow request records", async () => {
    await recordRequestAccessLog({
      requestId: "req_denied",
      method: "POST",
      url: "https://control.daoflow.local/trpc/triggerDeploy",
      statusCode: 403,
      durationMs: 33,
      errorCategory: "scope_denied"
    });
    await recordRequestAccessLog({
      requestId: "req_webhook",
      method: "POST",
      url: "https://control.daoflow.local/api/webhooks/github",
      statusCode: 500,
      durationMs: 1220
    });
    await recordRequestAccessLog({
      requestId: "req_token",
      method: "GET",
      url: "https://control.daoflow.local/api/v1/logs/stream/dep_1",
      statusCode: 200,
      durationMs: 12,
      authMethod: "api-token",
      tokenId: null,
      tokenPrefix: "dfl_token"
    });

    const failedAuth = await listRequestAccessLogs({ failedAuth: true });
    const apiTokens = await listRequestAccessLogs({ apiTokenOnly: true });
    const webhooks = await listRequestAccessLogs({ webhooksOnly: true });
    const slow = await listRequestAccessLogs({ slowMs: 1000 });

    expect(failedAuth.entries.map((entry) => entry.requestId)).toEqual(["req_denied"]);
    expect(apiTokens.entries.map((entry) => entry.requestId)).toEqual(["req_token"]);
    expect(webhooks.entries.map((entry) => entry.requestId)).toEqual(["req_webhook"]);
    expect(slow.entries.map((entry) => entry.requestId)).toEqual(["req_webhook"]);
  });

  it("prunes request records older than the retention window", async () => {
    await recordRequestAccessLog({
      requestId: "req_old",
      method: "GET",
      url: "https://control.daoflow.local/health",
      statusCode: 200,
      durationMs: 5
    });
    await recordRequestAccessLog({
      requestId: "req_new",
      method: "GET",
      url: "https://control.daoflow.local/health",
      statusCode: 200,
      durationMs: 6
    });

    await db
      .update(requestAccessLogs)
      .set({ createdAt: new Date(Date.now() - 3 * 24 * 60 * 60 * 1000) })
      .where(eq(requestAccessLogs.requestId, "req_old"));

    const result = await pruneRequestAccessLogs(1);
    const remaining = await listRequestAccessLogs({ limit: 10 });

    expect(result.prunedCount).toBe(1);
    expect(remaining.entries.map((entry) => entry.requestId)).toEqual(["req_new"]);
  });
});
