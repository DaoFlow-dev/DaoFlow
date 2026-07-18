import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "./db/connection";
import { servers } from "./db/schema/servers";
import { teamMembers, teams } from "./db/schema/teams";
import { users } from "./db/schema/users";
import { appRouter } from "./router";
import { discoverServerSshHostIdentities } from "./db/services/ssh-host-identities";
import { sshHostKeyFingerprint } from "./worker/ssh-host-key-scan";
import { resetTestDatabase } from "./test-db";
import { makeCustomSession } from "./testing/request-auth-fixtures";

vi.mock("./db/services/seed", () => ({
  ensureControlPlaneReady: vi.fn(),
  resetControlPlaneSeedState: vi.fn(),
  waitForControlPlaneSeedIdle: vi.fn()
}));

vi.mock("./db/services/server-readiness", () => ({
  verifyServerReadiness: vi.fn((server: typeof servers.$inferSelect) => Promise.resolve(server))
}));

const actor = {
  requestedByUserId: "user_host_identity_owner",
  requestedByEmail: "host-identity-owner@daoflow.local",
  requestedByRole: "owner" as const
};
const teamId = "team_host_identity";
const serverId = "srv_host_identity";
const operatorId = "user_host_identity_operator";

function observedKey(publicKey: string) {
  return {
    algorithm: "ssh-ed25519",
    publicKey,
    fingerprint: sshHostKeyFingerprint(publicKey)
  };
}

async function observe(publicKey: string) {
  const result = await discoverServerSshHostIdentities({
    serverId,
    teamId,
    actor,
    scan: () => Promise.resolve([observedKey(publicKey)])
  });
  if (!result) throw new Error("Expected host identity observation state.");
  const identity = result.identities.find((candidate) => candidate.publicKey === publicKey);
  if (!identity) throw new Error("Expected observed host identity.");
  return identity;
}

function commandInput(identity: Awaited<ReturnType<typeof observe>>) {
  return {
    identityId: identity.id,
    algorithm: identity.algorithm,
    publicKey: identity.publicKey,
    fingerprint: identity.fingerprint
  };
}

describe("SSH host identity routes", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await db.insert(users).values([
      {
        id: actor.requestedByUserId,
        email: actor.requestedByEmail,
        name: "SSH Host Identity Owner",
        username: "ssh-host-identity-owner",
        emailVerified: true,
        role: "owner",
        status: "active",
        defaultTeamId: teamId,
        createdAt: new Date(),
        updatedAt: new Date()
      },
      {
        id: operatorId,
        email: "host-identity-operator@daoflow.local",
        name: "SSH Host Identity Operator",
        username: "ssh-host-identity-operator",
        emailVerified: true,
        role: "operator",
        status: "active",
        defaultTeamId: teamId,
        createdAt: new Date(),
        updatedAt: new Date()
      }
    ]);
    await db.insert(teams).values({
      id: teamId,
      name: "SSH Host Identity Team",
      slug: "ssh-host-identity-team",
      status: "active",
      createdByUserId: actor.requestedByUserId,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await db.insert(teamMembers).values([
      { teamId, userId: actor.requestedByUserId, role: "owner", createdAt: new Date() },
      { teamId, userId: operatorId, role: "operator", createdAt: new Date() }
    ]);
    await db.insert(servers).values({
      id: serverId,
      name: "ssh-host-identity-server",
      host: "198.51.100.200",
      region: "test",
      teamId,
      sshPort: 22,
      kind: "docker-engine",
      status: "pending host identity approval",
      metadata: {},
      registeredByUserId: actor.requestedByUserId,
      createdAt: new Date(),
      updatedAt: new Date()
    });
  });

  it("allows an admin to approve and an owner to rotate while denying an operator", async () => {
    const first = await observe("AQIDBA==");
    const operator = appRouter.createCaller({
      requestId: "host-identity-operator",
      session: makeCustomSession({
        id: operatorId,
        email: "host-identity-operator@daoflow.local",
        name: "SSH Host Identity Operator",
        role: "operator"
      })
    });
    await expect(
      operator.approveServerSshHostIdentity({ serverId, ...commandInput(first) })
    ).rejects.toMatchObject({ code: "FORBIDDEN" });

    const admin = appRouter.createCaller({
      requestId: "host-identity-admin",
      session: makeCustomSession({
        id: actor.requestedByUserId,
        email: actor.requestedByEmail,
        name: "SSH Host Identity Owner",
        role: "admin"
      })
    });
    const approved = await admin.approveServerSshHostIdentity({
      serverId,
      ...commandInput(first)
    });
    expect(approved.identity.fingerprint).toBe(first.fingerprint);

    const replacement = await observe("BQYHCA==");
    const owner = appRouter.createCaller({
      requestId: "host-identity-owner",
      session: makeCustomSession({
        id: actor.requestedByUserId,
        email: actor.requestedByEmail,
        name: "SSH Host Identity Owner",
        role: "owner"
      })
    });
    const rotated = await owner.rotateServerSshHostIdentity({
      serverId,
      ...commandInput(replacement)
    });
    expect(rotated).toMatchObject({
      oldIdentity: { fingerprint: first.fingerprint },
      identity: { fingerprint: replacement.fingerprint }
    });
  });
});
