import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { approvalRequests } from "../schema/audit";
import { teams } from "../schema/teams";
import { approveApprovalRequest, listApprovalQueue, rejectApprovalRequest } from "./approvals";
import { resetTestDatabaseWithControlPlane } from "../../test-db";

const teamAId = "team_approval_scope_a";
const teamBId = "team_approval_scope_b";
const approver = {
  userId: "user_foundation_operator",
  email: "ops@d.io",
  role: "operator" as const
};

async function createScopedTeams() {
  await db.insert(teams).values([
    {
      id: teamAId,
      name: "Approval Scope Team A",
      slug: "approval-scope-team-a",
      status: "active",
      createdByUserId: "user_foundation_owner",
      createdAt: new Date(),
      updatedAt: new Date()
    },
    {
      id: teamBId,
      name: "Approval Scope Team B",
      slug: "approval-scope-team-b",
      status: "active",
      createdByUserId: "user_foundation_owner",
      createdAt: new Date(),
      updatedAt: new Date()
    }
  ]);
}

async function createPendingApproval(id: string, teamId: string) {
  await db.insert(approvalRequests).values({
    id,
    teamId,
    actionType: "compose-release",
    targetResource: `compose-service/${id}`,
    reason: "Verify team-scoped approval handling.",
    status: "pending",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner",
    inputSummary: {
      resourceLabel: `Approval ${id}`,
      riskLevel: "elevated",
      recommendedChecks: [],
      expiresAt: new Date(Date.now() + 60_000).toISOString()
    },
    createdAt: new Date()
  });
}

describe("team-scoped approval services", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    await createScopedTeams();
  });

  it("lists only the approval requests owned by the requested team", async () => {
    await createPendingApproval("apr_scope_queue_a", teamAId);
    await createPendingApproval("apr_scope_queue_b", teamBId);

    const teamAQueue = await listApprovalQueue(teamAId, 24);
    const teamBQueue = await listApprovalQueue(teamBId, 24);

    expect(teamAQueue).toMatchObject({
      summary: {
        totalRequests: 1,
        pendingRequests: 1,
        approvedRequests: 0,
        rejectedRequests: 0,
        criticalRequests: 0
      }
    });
    expect(teamAQueue.requests.map((request) => request.id)).toEqual(["apr_scope_queue_a"]);
    expect(teamBQueue.requests.map((request) => request.id)).toEqual(["apr_scope_queue_b"]);
  });

  it("treats cross-team approval IDs as not found before approving", async () => {
    await createPendingApproval("apr_scope_approve_b", teamBId);

    await expect(
      approveApprovalRequest(
        "apr_scope_approve_b",
        teamAId,
        approver.userId,
        approver.email,
        approver.role
      )
    ).resolves.toEqual({ status: "not-found" });

    const [pending] = await db
      .select({ status: approvalRequests.status })
      .from(approvalRequests)
      .where(eq(approvalRequests.id, "apr_scope_approve_b"));
    expect(pending?.status).toBe("pending");

    await expect(
      approveApprovalRequest(
        "apr_scope_approve_b",
        teamBId,
        approver.userId,
        approver.email,
        approver.role
      )
    ).resolves.toMatchObject({ status: "ok", request: { id: "apr_scope_approve_b" } });
  });

  it("treats cross-team approval IDs as not found before rejecting", async () => {
    await createPendingApproval("apr_scope_reject_a", teamAId);

    await expect(
      rejectApprovalRequest(
        "apr_scope_reject_a",
        teamBId,
        approver.userId,
        approver.email,
        approver.role
      )
    ).resolves.toEqual({ status: "not-found" });

    const [pending] = await db
      .select({ status: approvalRequests.status })
      .from(approvalRequests)
      .where(eq(approvalRequests.id, "apr_scope_reject_a"));
    expect(pending?.status).toBe("pending");

    await expect(
      rejectApprovalRequest(
        "apr_scope_reject_a",
        teamAId,
        approver.userId,
        approver.email,
        approver.role
      )
    ).resolves.toMatchObject({ status: "ok", request: { id: "apr_scope_reject_a" } });
  });
});
