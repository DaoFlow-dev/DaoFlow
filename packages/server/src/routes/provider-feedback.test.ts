import { beforeEach, describe, expect, it } from "vitest";
import { db } from "../db/connection";
import { servers } from "../db/schema/servers";
import { teamMembers, teams } from "../db/schema/teams";
import { users } from "../db/schema/users";
import { queueProviderFeedbackIntent } from "../db/services/provider-feedback-intents";
import { createProviderFeedbackFixture } from "../db/services/provider-feedback-fixtures";
import { appRouter } from "../router";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import { makeCustomSession, makeSession } from "../testing/request-auth-fixtures";

const teamB = {
  id: "team_provider_feedback_b",
  ownerId: "user_provider_feedback_b",
  ownerEmail: "provider-feedback-b@example.invalid",
  serverId: "srv_provider_feedback_b"
};

async function queueFeedback(deploymentId: string) {
  await db.transaction((tx) =>
    queueProviderFeedbackIntent(tx, {
      deploymentId,
      transition: "queued"
    })
  );
}

async function createTeamB() {
  await db.insert(users).values({
    id: teamB.ownerId,
    email: teamB.ownerEmail,
    name: "Provider Feedback Team B Owner",
    username: "provider-feedback-b-owner",
    emailVerified: true,
    role: "owner",
    status: "active",
    defaultTeamId: teamB.id,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await db.insert(teams).values({
    id: teamB.id,
    name: "Provider Feedback Team B",
    slug: "provider-feedback-team-b",
    status: "active",
    createdByUserId: teamB.ownerId,
    createdAt: new Date(),
    updatedAt: new Date()
  });
  await db.insert(teamMembers).values({
    teamId: teamB.id,
    userId: teamB.ownerId,
    role: "owner",
    createdAt: new Date()
  });
  await db.insert(servers).values({
    id: teamB.serverId,
    name: "provider-feedback-team-b-target",
    host: "198.51.100.227",
    teamId: teamB.id,
    status: "ready",
    registeredByUserId: teamB.ownerId,
    createdAt: new Date(),
    updatedAt: new Date()
  });
}

describe("provider feedback read API", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("returns only the caller's team feedback and supports state filtering", async () => {
    const teamAFixture = await createProviderFeedbackFixture();
    await queueFeedback(teamAFixture.deploymentId);
    await createTeamB();
    const teamBFixture = await createProviderFeedbackFixture({
      teamId: teamB.id,
      serverId: teamB.serverId,
      actor: {
        requestedByUserId: teamB.ownerId,
        requestedByEmail: teamB.ownerEmail,
        requestedByRole: "owner"
      }
    });
    await queueFeedback(teamBFixture.deploymentId);

    const teamACaller = appRouter.createCaller({
      requestId: "provider-feedback-team-a",
      session: makeSession("owner")
    });
    const teamBCaller = appRouter.createCaller({
      requestId: "provider-feedback-team-b",
      session: makeCustomSession({
        id: teamB.ownerId,
        email: teamB.ownerEmail,
        name: "Provider Feedback Team B Owner",
        role: "owner"
      })
    });

    const teamAFeedback = await teamACaller.providerFeedback({ states: ["pending"] });
    const teamBFeedback = await teamBCaller.providerFeedback({ states: ["pending"] });

    expect(teamAFeedback.map((row) => row.deploymentId)).toContain(teamAFixture.deploymentId);
    expect(teamAFeedback.map((row) => row.deploymentId)).not.toContain(teamBFixture.deploymentId);
    expect(teamBFeedback.map((row) => row.deploymentId)).toContain(teamBFixture.deploymentId);
    expect(teamBFeedback.map((row) => row.deploymentId)).not.toContain(teamAFixture.deploymentId);
  });
});
