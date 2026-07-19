import { and, eq, sql } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "../connection";
import { approvalActionDispatches, approvalRequests, auditEntries } from "../schema/audit";
import { deployments } from "../schema/deployments";
import { environments, projects } from "../schema/projects";
import { teamMembers, teams } from "../schema/teams";
import { users } from "../schema/users";
import { resetTestDatabaseWithControlPlane } from "../../test-db";
import {
  claimNextApprovalActionDispatch,
  processNextApprovalActionDispatch,
  reconcileApprovalActionDispatches,
  retryApprovalActionDispatch
} from "./approval-dispatch-service";
import { approveApprovalRequest, listApprovalQueue } from "./approvals";
import { createDeploymentRecord } from "./deployments";

const approver = {
  userId: "user_foundation_operator",
  email: "ops@daoflow.local",
  role: "operator" as const
};

let requestCounter = 0;

async function createPendingComposeApproval(input?: { imageTag: string | null }) {
  requestCounter += 1;
  const requestId = `apr_dispatch_${requestCounter}`;
  const now = new Date();
  await db.insert(approvalRequests).values({
    id: requestId,
    teamId: "team_foundation",
    actionType: "compose-release",
    targetResource: `compose-service/service_${requestCounter}`,
    reason: "Require an independent operator decision before releasing this service.",
    status: "pending",
    requestedByUserId: "user_foundation_owner",
    requestedByEmail: "owner@daoflow.local",
    requestedByRole: "owner",
    inputSummary: {
      resourceLabel: `Dispatch fixture ${requestCounter}`,
      riskLevel: "elevated",
      commandSummary: "Release a pinned Compose image.",
      requestedAt: now.toISOString(),
      expiresAt: new Date(now.getTime() + 60_000).toISOString(),
      recommendedChecks: [],
      actionPayload: {
        composeServiceId: `service_${requestCounter}`,
        commitSha: "abcdef1234567890",
        imageTag: input ? input.imageTag : "example/service:stable",
        snapshot: {
          projectId: "proj_fixture",
          environmentId: "env_fixture",
          targetServerId: "srv_fixture",
          composeFilePath: "/srv/compose.yml",
          secretPolicy: "environment-scoped-encrypted"
        }
      }
    },
    createdAt: now
  });
  return requestId;
}

async function approveFixture(requestId: string) {
  return approveApprovalRequest(
    requestId,
    "team_foundation",
    approver.userId,
    approver.email,
    approver.role
  );
}

describe("approval action dispatch service", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  afterEach(async () => {
    await db.execute(
      sql`DROP TRIGGER IF EXISTS approval_dispatch_insert_failure ON approval_action_dispatches`
    );
    await db.execute(sql`DROP FUNCTION IF EXISTS fail_approval_dispatch_insert()`);
  });

  it("rolls back the approval decision when saving its durable dispatch intent fails", async () => {
    const requestId = await createPendingComposeApproval();
    await db.execute(sql`
      CREATE FUNCTION fail_approval_dispatch_insert() RETURNS trigger AS $$
      BEGIN
        RAISE EXCEPTION 'approval dispatch insert failed';
      END;
      $$ LANGUAGE plpgsql
    `);
    await db.execute(sql`
      CREATE TRIGGER approval_dispatch_insert_failure
      BEFORE INSERT ON approval_action_dispatches
      FOR EACH ROW EXECUTE FUNCTION fail_approval_dispatch_insert()
    `);

    await expect(approveFixture(requestId)).rejects.toThrow();

    const [request] = await db
      .select({ status: approvalRequests.status })
      .from(approvalRequests)
      .where(eq(approvalRequests.id, requestId));
    const dispatches = await db
      .select()
      .from(approvalActionDispatches)
      .where(eq(approvalActionDispatches.approvalRequestId, requestId));
    const decisionAudit = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.targetResource, `approval-request/${requestId}`),
          eq(auditEntries.action, "approval.approve")
        )
      );

    expect(request?.status).toBe("pending");
    expect(dispatches).toEqual([]);
    expect(decisionAudit).toEqual([]);
  });

  it("invalidates legacy Compose approvals without an exact frozen image", async () => {
    for (const imageTag of [null, "   "]) {
      const requestId = await createPendingComposeApproval({ imageTag });

      await expect(approveFixture(requestId)).resolves.toEqual({ status: "invalid-payload" });
      const dispatches = await db
        .select()
        .from(approvalActionDispatches)
        .where(eq(approvalActionDispatches.approvalRequestId, requestId));

      expect(dispatches).toEqual([]);
    }
  });

  it("reclaims a lease after a crash and replays the same operation ID without duplicate submission", async () => {
    const requestId = await createPendingComposeApproval();
    const approved = await approveFixture(requestId);
    expect(approved.status).toBe("ok");
    if (approved.status !== "ok") return;

    const claimed = await claimNextApprovalActionDispatch({ now: new Date() });
    expect(claimed?.operationId).toBe(approved.request.operationId);
    if (!claimed) return;

    const acceptedOperations = new Set([claimed.operationId]);
    const replay = await processNextApprovalActionDispatch({
      now: new Date(Date.now() + 31_000),
      execute: async (dispatch) => {
        acceptedOperations.add(dispatch.operationId);
      }
    });

    expect(acceptedOperations).toEqual(new Set([approved.request.operationId]));
    expect(replay).toMatchObject({
      status: "dispatched",
      dispatch: { operationId: approved.request.operationId, attemptCount: 2 }
    });
  });

  it("retries transient failures and records a terminal failure after the retry budget", async () => {
    const requestId = await createPendingComposeApproval();
    await approveFixture(requestId);
    const firstAttemptAt = new Date(Date.now() + 1_000);

    const first = await processNextApprovalActionDispatch({
      now: firstAttemptAt,
      maxAttempts: 2,
      execute: async () => {
        throw new Error("Temporal endpoint is temporarily unavailable.");
      }
    });
    expect(first).toMatchObject({ status: "retrying", dispatch: { attemptCount: 1 } });

    const second = await processNextApprovalActionDispatch({
      now: new Date(firstAttemptAt.getTime() + 2_000),
      maxAttempts: 2,
      execute: async () => {
        throw new Error("Temporal endpoint is temporarily unavailable.");
      }
    });
    expect(second).toMatchObject({
      status: "terminal-failure",
      dispatch: {
        attemptCount: 2,
        lastError: "Temporal endpoint is temporarily unavailable."
      }
    });
  });

  it("fails closed when the approving actor loses organization decision authority", async () => {
    const requestId = await createPendingComposeApproval();
    await approveFixture(requestId);
    await db
      .update(teamMembers)
      .set({ role: "member" })
      .where(
        and(eq(teamMembers.userId, approver.userId), eq(teamMembers.teamId, "team_foundation"))
      );

    const result = await processNextApprovalActionDispatch();

    expect(result).toMatchObject({
      status: "terminal-failure",
      dispatch: {
        lastError: "The approving actor no longer has decision authority for this team."
      }
    });
  });

  it("keeps executing for the approved team when the actor changes their active team", async () => {
    const requestId = await createPendingComposeApproval();
    await approveFixture(requestId);
    const otherTeamId = "team_dispatch_other";
    await db.insert(teams).values({
      id: otherTeamId,
      name: "Dispatch Other Team",
      slug: "dispatch-other-team",
      status: "active",
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await db.insert(teamMembers).values({
      teamId: otherTeamId,
      userId: approver.userId,
      role: "owner"
    });
    await db.update(users).set({ defaultTeamId: otherTeamId }).where(eq(users.id, approver.userId));

    const result = await processNextApprovalActionDispatch();

    expect(result).toMatchObject({
      status: "terminal-failure",
      dispatch: {
        lastError: "The approved Compose release target is no longer available to this team."
      }
    });
  });

  it("does not requeue a completed submission and hides a next-attempt time", async () => {
    const requestId = await createPendingComposeApproval();
    await approveFixture(requestId);
    const now = new Date();
    await db
      .update(approvalActionDispatches)
      .set({ status: "terminal-failure", dispatchedAt: now, completedAt: now })
      .where(eq(approvalActionDispatches.approvalRequestId, requestId));

    const retry = await retryApprovalActionDispatch({
      requestId,
      teamId: "team_foundation",
      userId: approver.userId,
      email: approver.email,
      role: approver.role
    });
    const queue = await listApprovalQueue("team_foundation");

    expect(retry).toEqual({ status: "invalid-state" });
    expect(queue.requests.find((request) => request.id === requestId)).toMatchObject({
      dispatchStatus: "terminal-failure",
      dispatchNextAttemptAt: null
    });
  });

  it("returns dispatch lifecycle fields and reconciles the linked operation to success", async () => {
    const requestId = await createPendingComposeApproval();
    const approved = await approveFixture(requestId);
    expect(approved.status).toBe("ok");
    if (approved.status !== "ok") return;

    const queue = await listApprovalQueue("team_foundation");
    expect(queue.requests.find((request) => request.id === requestId)).toMatchObject({
      dispatchStatus: "pending",
      operationId: approved.request.operationId,
      dispatchAttempts: 0,
      dispatchError: null
    });

    await processNextApprovalActionDispatch({
      now: new Date(Date.now() + 1_000),
      execute: async () => undefined
    });
    const [completedDeployment] = await db
      .select({ id: deployments.id })
      .from(deployments)
      .limit(1);
    expect(completedDeployment).toBeDefined();
    if (!completedDeployment) return;
    await db
      .update(deployments)
      .set({ status: "completed", conclusion: "succeeded" })
      .where(eq(deployments.id, completedDeployment.id));

    await db
      .update(approvalActionDispatches)
      .set({ operationId: completedDeployment.id })
      .where(eq(approvalActionDispatches.approvalRequestId, requestId));
    const reconciled = await reconcileApprovalActionDispatches();

    expect(reconciled).toHaveLength(1);
    expect(reconciled[0]).toMatchObject({
      status: "succeeded",
      operationId: completedDeployment.id
    });
  });

  it("reuses a preallocated deployment operation ID without creating duplicate records", async () => {
    const [seedDeployment] = await db
      .select({
        projectName: projects.name,
        environmentName: environments.name,
        targetServerId: deployments.targetServerId
      })
      .from(deployments)
      .innerJoin(projects, eq(projects.id, deployments.projectId))
      .innerJoin(environments, eq(environments.id, deployments.environmentId))
      .where(eq(projects.teamId, "team_foundation"))
      .limit(1);
    expect(seedDeployment).toBeDefined();
    if (!seedDeployment) return;

    const input = {
      deploymentId: "op_deploy_idempotent_240",
      projectName: seedDeployment.projectName,
      environmentName: seedDeployment.environmentName,
      serviceName: "idempotent-approved-release",
      sourceType: "compose" as const,
      targetServerId: seedDeployment.targetServerId,
      commitSha: "abcdef1234567890",
      imageTag: "example/idempotent:stable",
      requestedByUserId: approver.userId,
      requestedByEmail: approver.email,
      requestedByRole: approver.role,
      teamId: "team_foundation",
      approvalRequestId: "apr_idempotent_240",
      approvalDispatchId: "adsp_idempotent_240",
      steps: [{ label: "Queue execution handoff", detail: "Submit once." }]
    };

    const first = await createDeploymentRecord(input);
    const replay = await createDeploymentRecord(input);
    const records = await db
      .select({ id: deployments.id })
      .from(deployments)
      .where(eq(deployments.id, input.deploymentId));

    expect(first?.id).toBe(input.deploymentId);
    expect(replay?.id).toBe(input.deploymentId);
    expect(records).toEqual([{ id: input.deploymentId }]);
  });

  it("reconciles a new dispatch before older rows beyond the batch limit", async () => {
    const [seedDeployment] = await db.select({ id: deployments.id }).from(deployments).limit(1);
    expect(seedDeployment).toBeDefined();
    if (!seedDeployment) return;
    await db
      .update(deployments)
      .set({ status: "completed", conclusion: "succeeded" })
      .where(eq(deployments.id, seedDeployment.id));

    const now = new Date();
    const requests = Array.from({ length: 33 }, (_, index) => ({
      id: `apr_fair_${index}`,
      teamId: "team_foundation",
      actionType: "compose-release",
      targetResource: `compose-service/fair-${index}`,
      status: "approved",
      inputSummary: {},
      createdAt: new Date(now.getTime() - (33 - index) * 1_000)
    }));
    await db.insert(approvalRequests).values(requests);
    await db.insert(approvalActionDispatches).values(
      requests.map((request, index) => ({
        id: `adsp_fair_${index}`,
        approvalRequestId: request.id,
        teamId: "team_foundation",
        actionType: "compose-release",
        idempotencyKey: `approval:${request.id}`,
        operationId: index === 32 ? seedDeployment.id : `op_missing_${index}`,
        payloadVersion: 1,
        payloadHash: "a".repeat(64),
        actionPayload: {},
        status: "dispatched",
        attemptCount: 1,
        nextAttemptAt: now,
        dispatchedAt: request.createdAt,
        lastReconciledAt: index === 32 ? null : request.createdAt,
        createdAt: request.createdAt,
        updatedAt: request.createdAt
      }))
    );

    await reconcileApprovalActionDispatches({ limit: 32, now });
    const [newDispatch] = await db
      .select({ status: approvalActionDispatches.status })
      .from(approvalActionDispatches)
      .where(eq(approvalActionDispatches.id, "adsp_fair_32"));

    expect(newDispatch?.status).toBe("succeeded");
  });
});
