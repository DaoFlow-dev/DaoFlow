import { eq } from "drizzle-orm";
import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/connection";
import { approvalRequests } from "../db/schema/audit";
import { environments } from "../db/schema/projects";
import { servers } from "../db/schema/servers";
import { teamMembers, teams } from "../db/schema/teams";
import { users } from "../db/schema/users";
import { asRecord } from "../db/services/json-helpers";
import { appRouter } from "../router";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import { createProjectEnvironmentServiceFixture } from "../testing/project-fixtures";
import {
  makeCustomSession,
  makeSession,
  makeTokenAuthContext
} from "../testing/request-auth-fixtures";

const teamAId = "team_foundation";
const teamBId = "team_approval_scope_b";
const teamBOwnerId = "user_approval_scope_b_owner";
const teamBServerId = "srv_approval_scope_b";
const teamBOwnerEmail = "approval-scope-b-owner@daoflow.local";

const teamAOwnerRequester = {
  requestedByUserId: "user_foundation_owner",
  requestedByEmail: "owner@daoflow.local",
  requestedByRole: "owner" as const
};

const teamBOwnerRequester = {
  requestedByUserId: teamBOwnerId,
  requestedByEmail: teamBOwnerEmail,
  requestedByRole: "owner" as const
};

async function createTeamB() {
  await db.insert(users).values({
    id: teamBOwnerId,
    email: teamBOwnerEmail,
    name: "Approval Scope Team B Owner",
    username: "approval-scope-b-owner",
    emailVerified: true,
    role: "owner",
    status: "active",
    defaultTeamId: teamBId,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  await db.insert(teams).values({
    id: teamBId,
    name: "Approval Scope Team B",
    slug: "approval-scope-team-b",
    status: "active",
    createdByUserId: teamBOwnerId,
    createdAt: new Date(),
    updatedAt: new Date()
  });

  await db.insert(teamMembers).values({
    teamId: teamBId,
    userId: teamBOwnerId,
    role: "owner",
    createdAt: new Date()
  });

  await db.insert(servers).values({
    id: teamBServerId,
    name: "approval-scope-team-b-target",
    host: "198.51.100.241",
    teamId: teamBId,
    status: "ready",
    registeredByUserId: teamBOwnerId,
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

async function createApprovalTarget(
  teamId: string,
  requester: typeof teamAOwnerRequester,
  label: string,
  serverId: string
) {
  const fixture = await createProjectEnvironmentServiceFixture({
    project: {
      name: `approval-scope-${label}-project`,
      description: `Approval scope target for ${label}.`,
      teamId
    },
    environment: {
      name: `approval-scope-${label}-environment`,
      targetServerId: serverId
    },
    service: {
      name: `approval-scope-${label}-service`,
      sourceType: "compose",
      imageReference: `ghcr.io/daoflow/approval-scope-${label}:test`,
      composeServiceName: `approval-scope-${label}`,
      targetServerId: serverId
    },
    requester
  });

  await db
    .update(environments)
    .set({
      config: {
        projectName: fixture.project.name,
        targetServerId: serverId,
        targetServerName: serverId,
        composeFilePath: "/srv/daoflow/compose.yaml",
        networkName: `approval-scope-${label}-network`,
        composeServices: [
          {
            id: fixture.service.id,
            serviceName: fixture.service.name,
            imageReference: `ghcr.io/daoflow/approval-scope-${label}:test`,
            replicaCount: 1,
            exposedPorts: [],
            dependencies: [],
            volumeMounts: []
          }
        ]
      },
      updatedAt: new Date()
    })
    .where(eq(environments.id, fixture.environment.id));

  return fixture.service.id;
}

async function requestApproval(
  caller: ReturnType<typeof appRouter.createCaller>,
  composeServiceId: string,
  reason: string
) {
  return caller.requestApproval({
    actionType: "compose-release",
    composeServiceId,
    commitSha: "abcdef1234567",
    reason
  });
}

function teamBOwnerCaller() {
  return appRouter.createCaller({
    requestId: "approval-scope-team-b-owner",
    session: makeCustomSession({
      id: teamBOwnerId,
      email: teamBOwnerEmail,
      name: "Approval Scope Team B Owner",
      role: "owner"
    })
  });
}

describe("team-scoped approval routes", () => {
  let teamATargetId: string;
  let teamBTargetId: string;

  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
    await createTeamB();
    teamATargetId = await createApprovalTarget(
      teamAId,
      teamAOwnerRequester,
      "team-a",
      "srv_foundation_1"
    );
    teamBTargetId = await createApprovalTarget(
      teamBId,
      teamBOwnerRequester,
      "team-b",
      teamBServerId
    );
  });

  it("rejects whitespace-only approved image tags before persistence", async () => {
    const caller = appRouter.createCaller({
      requestId: "approval-whitespace-image",
      session: makeSession("owner")
    });

    await expect(
      caller.requestApproval({
        actionType: "compose-release",
        composeServiceId: teamATargetId,
        commitSha: "abcdef1234567",
        imageTag: "   ",
        reason: "Require an exact immutable image before approval."
      })
    ).rejects.toMatchObject({ code: "BAD_REQUEST" });
  });

  it("keeps team A approval queue metadata isolated from team B", async () => {
    const teamAOwner = appRouter.createCaller({
      requestId: "approval-scope-queue-team-a",
      session: makeSession("owner")
    });
    const teamBOwner = teamBOwnerCaller();
    const teamARequest = await requestApproval(
      teamAOwner,
      teamATargetId,
      "Team A approval metadata must remain visible only to Team A."
    );
    const teamBRequest = await requestApproval(
      teamBOwner,
      teamBTargetId,
      "Team B approval metadata must never appear in Team A queue results."
    );

    expect(asRecord(asRecord(teamARequest.inputSummary).actionPayload)).toMatchObject({
      imageTag: "ghcr.io/daoflow/approval-scope-team-a:test"
    });

    const queue = await teamAOwner.approvalQueue({});

    expect(queue.requests.map((request) => request.id)).toContain(teamARequest.id);
    expect(queue.requests.map((request) => request.id)).not.toContain(teamBRequest.id);
    expect(queue.requests.every((request) => request.teamId === teamAId)).toBe(true);
    expect(queue.requests).not.toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: teamBRequest.id,
          reason: teamBRequest.reason,
          targetResource: teamBRequest.targetResource
        })
      ])
    );
  });

  it("returns NOT_FOUND for cross-team approve and reject IDs without changing the request", async () => {
    const teamAAdmin = appRouter.createCaller({
      requestId: "approval-scope-cross-team-admin",
      session: makeSession("operator")
    });
    const teamBRequest = await requestApproval(
      teamBOwnerCaller(),
      teamBTargetId,
      "Team B request must not be executable by Team A."
    );

    await expect(
      teamAAdmin.approveApprovalRequest({ requestId: teamBRequest.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });
    await expect(
      teamAAdmin.rejectApprovalRequest({ requestId: teamBRequest.id })
    ).rejects.toMatchObject({ code: "NOT_FOUND" });

    const [storedRequest] = await db
      .select()
      .from(approvalRequests)
      .where(eq(approvalRequests.id, teamBRequest.id));
    expect(storedRequest).toMatchObject({
      teamId: teamBId,
      status: "pending",
      resolvedByUserId: null,
      resolvedByEmail: null,
      resolvedAt: null
    });
  });

  it("denies ordinary members while allowing owner and admin memberships to decide", async () => {
    const teamAOwner = appRouter.createCaller({
      requestId: "approval-scope-membership-owner",
      session: makeSession("owner")
    });
    const teamAAdmin = appRouter.createCaller({
      requestId: "approval-scope-membership-admin",
      session: makeSession("operator")
    });
    const teamAMember = appRouter.createCaller({
      requestId: "approval-scope-membership-member",
      session: makeCustomSession({
        id: "user_developer",
        email: "developer@daoflow.local",
        name: "Foundation Developer",
        role: "operator"
      })
    });

    const ownerRequest = await requestApproval(
      teamAOwner,
      teamATargetId,
      "Team A owner requests an admin decision for this release."
    );

    await expect(
      teamAMember.approveApprovalRequest({ requestId: ownerRequest.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });
    await expect(
      teamAMember.rejectApprovalRequest({ requestId: ownerRequest.id })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    await expect(
      teamAAdmin.approveApprovalRequest({ requestId: ownerRequest.id })
    ).resolves.toMatchObject({ id: ownerRequest.id, status: "approved" });

    const adminRequest = await requestApproval(
      teamAAdmin,
      teamATargetId,
      "Team A admin requests an owner decision for this release."
    );
    await expect(
      teamAOwner.rejectApprovalRequest({ requestId: adminRequest.id })
    ).resolves.toMatchObject({ id: adminRequest.id, status: "rejected" });
  });

  it("uses the linked user team for an API-token caller queue and decision", async () => {
    const teamAAdmin = appRouter.createCaller({
      requestId: "approval-scope-token-requester",
      session: makeSession("operator")
    });
    const teamARequest = await requestApproval(
      teamAAdmin,
      teamATargetId,
      "Team A token caller should resolve the linked owner team."
    );
    const teamBRequest = await requestApproval(
      teamBOwnerCaller(),
      teamBTargetId,
      "Team B token isolation marker."
    );
    const linkedOwnerTokenCaller = appRouter.createCaller({
      requestId: "approval-scope-linked-token",
      session: makeSession("owner"),
      auth: makeTokenAuthContext("owner", ["approvals:decide"])
    });

    const queue = await linkedOwnerTokenCaller.approvalQueue({});
    expect(queue.requests.map((request) => request.id)).toContain(teamARequest.id);
    expect(queue.requests.map((request) => request.id)).not.toContain(teamBRequest.id);

    await expect(
      linkedOwnerTokenCaller.approveApprovalRequest({ requestId: teamARequest.id })
    ).resolves.toMatchObject({ id: teamARequest.id, status: "approved" });
  });
});
