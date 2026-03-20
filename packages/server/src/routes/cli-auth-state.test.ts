import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { resetTestDatabase } from "../test-db";

async function loadCliAuthState() {
  return import("./cli-auth-state");
}

async function loadDb() {
  return import("../db/connection");
}

async function loadCliAuthSchema() {
  return import("../db/schema/cli-auth");
}

async function loadUsersSchema() {
  return import("../db/schema/users");
}

describe("cli-auth-state", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    vi.resetModules();
  });

  it("persists pending CLI auth requests across module reloads", async () => {
    const initialState = await loadCliAuthState();
    const created = await initialState.createCliAuthRequest();

    vi.resetModules();

    const reloadedState = await loadCliAuthState();
    const loaded = await reloadedState.getCliAuthRequest(created.requestId, created.userCode);

    expect(loaded).not.toBeNull();
    expect(loaded?.requestId).toBe(created.requestId);
    expect(loaded?.userCode).toBe(created.userCode);
  });

  it("keeps approval and exchange state consistent across separate module instances", async () => {
    const creatorState = await loadCliAuthState();
    const { db } = await loadDb();
    const { users } = await loadUsersSchema();

    await db.insert(users).values({
      id: "cli_auth_approver",
      email: "owner@daoflow.local",
      name: "CLI Approver",
      role: "owner"
    });

    const created = await creatorState.createCliAuthRequest();

    vi.resetModules();

    const approverState = await loadCliAuthState();
    const requestToApprove = await approverState.getCliAuthRequest(
      created.requestId,
      created.userCode
    );

    expect(requestToApprove).not.toBeNull();

    const firstApproval = await approverState.approveCliAuthRequest(
      requestToApprove!,
      "session-token-1",
      "cli_auth_approver",
      "owner@daoflow.local"
    );

    vi.resetModules();

    const secondApproverState = await loadCliAuthState();
    const requestToReapprove = await secondApproverState.getCliAuthRequest(
      created.requestId,
      created.userCode
    );

    expect(requestToReapprove).not.toBeNull();

    const secondApproval = await secondApproverState.approveCliAuthRequest(
      requestToReapprove!,
      "session-token-2",
      "cli_auth_approver",
      "planner-agent@daoflow.local"
    );

    expect(secondApproval.exchangeCode).toBe(firstApproval.exchangeCode);
    expect(secondApproval.sessionToken).toBe("session-token-1");
    expect(secondApproval.approvedByUserId).toBe("cli_auth_approver");
    expect(secondApproval.approvedByEmail).toBe("owner@daoflow.local");

    vi.resetModules();

    const exchangerState = await loadCliAuthState();
    const requestToExchange = await exchangerState.getCliAuthRequest(
      created.requestId,
      created.userCode
    );

    expect(requestToExchange).not.toBeNull();

    await exchangerState.markCliAuthRequestExchanged(requestToExchange!);
    await exchangerState.markCliAuthRequestExchanged(requestToExchange!);

    vi.resetModules();

    const finalState = await loadCliAuthState();
    const exchanged = await finalState.getCliAuthRequest(created.requestId, created.userCode);
    expect(exchanged?.sessionToken).toBe("session-token-1");
    expect(exchanged?.exchangeCode).toBe(firstApproval.exchangeCode);
    expect(exchanged?.exchangedAt).not.toBeNull();
  });

  it("cleans up expired CLI auth requests on lookup", async () => {
    const state = await loadCliAuthState();
    const { db } = await loadDb();
    const { cliAuthRequests } = await loadCliAuthSchema();
    const created = await state.createCliAuthRequest();

    await db
      .update(cliAuthRequests)
      .set({ expiresAt: new Date(Date.now() - 1_000) })
      .where(eq(cliAuthRequests.id, created.requestId));

    const expired = await state.getCliAuthRequest(created.requestId, created.userCode);
    expect(expired).toBeNull();

    const [row] = await db
      .select({ id: cliAuthRequests.id })
      .from(cliAuthRequests)
      .where(eq(cliAuthRequests.id, created.requestId))
      .limit(1);

    expect(row).toBeUndefined();
  });
});
