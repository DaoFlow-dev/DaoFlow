import { and, eq } from "drizzle-orm";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "../connection";
import { auditEntries } from "../schema/audit";
import { servers } from "../schema/servers";
import { sshHostIdentities } from "../schema/ssh-host-identities";
import { teamMembers, teams } from "../schema/teams";
import { users } from "../schema/users";
import { resetTestDatabase } from "../../test-db";
import { sshHostKeyFingerprint, type ObservedSshHostKey } from "../../worker/ssh-host-key-scan";
import { registerServer } from "./servers";
import {
  approveServerSshHostIdentity,
  discoverServerSshHostIdentities,
  getApprovedSshHostIdentity,
  listServerSshHostIdentities,
  rotateServerSshHostIdentity
} from "./ssh-host-identities";

const actor = {
  requestedByUserId: "user_host_identity_owner",
  requestedByEmail: "host-identity-owner@daoflow.local",
  requestedByRole: "owner" as const
};
const teamId = "team_host_identity";
const serverId = "srv_host_identity";

function observedKey(publicKey: string): ObservedSshHostKey {
  return {
    algorithm: "ssh-ed25519",
    publicKey,
    fingerprint: sshHostKeyFingerprint(publicKey)
  };
}

function selection(identity: {
  id: string;
  algorithm: string;
  publicKey: string;
  fingerprint: string;
}) {
  return {
    identityId: identity.id,
    algorithm: identity.algorithm,
    publicKey: identity.publicKey,
    fingerprint: identity.fingerprint
  };
}

describe("SSH host identity service", () => {
  beforeEach(async () => {
    await resetTestDatabase();
    await db.insert(users).values({
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
    });
    await db.insert(teams).values({
      id: teamId,
      name: "SSH Host Identity Team",
      slug: "ssh-host-identity-team",
      status: "active",
      createdByUserId: actor.requestedByUserId,
      createdAt: new Date(),
      updatedAt: new Date()
    });
    await db.insert(teamMembers).values({
      teamId,
      userId: actor.requestedByUserId,
      role: "owner",
      createdAt: new Date()
    });
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

  it("records untrusted host keys during first enrollment without approving or connecting", async () => {
    const scan = vi.fn().mockResolvedValue([observedKey("AQIDBA==")]);
    const result = await registerServer({
      name: "ssh-host-identity-enrollment",
      host: "198.51.100.201",
      region: "test",
      sshPort: 22,
      sshUser: "debian",
      kind: "docker-engine",
      teamId,
      ...actor,
      scanSshHostKeys: scan
    });

    expect(result.status).toBe("ok");
    if (result.status !== "ok") {
      throw new Error("expected server enrollment to succeed");
    }
    expect(result.server.status).toBe("pending host identity approval");
    expect(scan).toHaveBeenCalledWith({ host: result.server.host, port: 22 });

    const state = await listServerSshHostIdentities(result.server.id, teamId);
    expect(state).toMatchObject({
      approved: null,
      identities: [
        {
          algorithm: "ssh-ed25519",
          fingerprint: sshHostKeyFingerprint("AQIDBA=="),
          status: "observed"
        }
      ]
    });
  });

  it("approves only the exact observed key and records a team-scoped audit entry", async () => {
    await discoverServerSshHostIdentities({
      serverId,
      teamId,
      actor,
      scan: () => Promise.resolve([observedKey("AQIDBA==")])
    });
    const beforeApproval = await listServerSshHostIdentities(serverId, teamId);
    if (!beforeApproval) throw new Error("Expected host identity state.");
    const identity = beforeApproval.identities[0];
    if (!identity) throw new Error("Expected one observed host identity.");

    const invalid = await approveServerSshHostIdentity({
      serverId,
      teamId,
      selection: { ...selection(identity), fingerprint: "SHA256:wrong" },
      actor
    });
    expect(invalid.status).toBe("selection_mismatch");

    const result = await approveServerSshHostIdentity({
      serverId,
      teamId,
      selection: selection(identity),
      actor
    });
    expect(result.status).toBe("approved");
    expect((await getApprovedSshHostIdentity(serverId, teamId))?.fingerprint).toBe(
      identity.fingerprint
    );

    const [audit] = await db
      .select()
      .from(auditEntries)
      .where(
        and(
          eq(auditEntries.targetResource, `server/${serverId}`),
          eq(auditEntries.action, "server.ssh-host-identity.approve")
        )
      );
    expect(audit.metadata).toMatchObject({ newFingerprint: identity.fingerprint });
  });

  it("allows only one approved key when two approvals race", async () => {
    await discoverServerSshHostIdentities({
      serverId,
      teamId,
      scan: () => Promise.resolve([observedKey("AQIDBA=="), observedKey("BQYHCA==")])
    });
    const identities = (await listServerSshHostIdentities(serverId, teamId))!.identities;

    const results = await Promise.all(
      identities.map((identity) =>
        approveServerSshHostIdentity({
          serverId,
          teamId,
          selection: selection(identity),
          actor
        })
      )
    );

    expect(results.filter((result) => result.status === "approved")).toHaveLength(1);
    expect(results.filter((result) => result.status === "rotation_required")).toHaveLength(1);
    const approvedRows = await db
      .select()
      .from(sshHostIdentities)
      .where(
        and(eq(sshHostIdentities.serverId, serverId), eq(sshHostIdentities.status, "approved"))
      );
    expect(approvedRows).toHaveLength(1);

    const approvalAudits = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.action, "server.ssh-host-identity.approve"));
    expect(approvalAudits).toHaveLength(1);
  });

  it("reports mismatches without replacing the approved key, then rotates through an explicit action", async () => {
    const firstKey = observedKey("AQIDBA==");
    const nextKey = observedKey("BQYHCA==");
    await discoverServerSshHostIdentities({
      serverId,
      teamId,
      scan: () => Promise.resolve([firstKey])
    });
    const initialState = await listServerSshHostIdentities(serverId, teamId);
    if (!initialState) throw new Error("Expected initial host identity state.");
    const firstIdentity = initialState.identities[0];
    if (!firstIdentity) throw new Error("Expected initial observed host identity.");
    await approveServerSshHostIdentity({
      serverId,
      teamId,
      selection: selection(firstIdentity),
      actor
    });

    const mismatch = await discoverServerSshHostIdentities({
      serverId,
      teamId,
      scan: () => Promise.resolve([nextKey])
    });
    expect(mismatch?.verification).toBe("mismatch");
    expect(mismatch?.approved?.fingerprint).toBe(firstKey.fingerprint);

    if (!mismatch) throw new Error("Expected mismatch observation state.");
    const replacement = mismatch.identities.find(
      (identity) => identity.fingerprint === nextKey.fingerprint
    );
    if (!replacement) throw new Error("Expected replacement host identity.");
    const rotation = await rotateServerSshHostIdentity({
      serverId,
      teamId,
      selection: selection(replacement),
      actor
    });
    expect(rotation).toMatchObject({
      status: "rotated",
      oldIdentity: { fingerprint: firstKey.fingerprint },
      identity: { fingerprint: nextKey.fingerprint, status: "approved" }
    });
    expect((await getApprovedSshHostIdentity(serverId, teamId))?.fingerprint).toBe(
      nextKey.fingerprint
    );

    const rows = await db
      .select()
      .from(sshHostIdentities)
      .where(eq(sshHostIdentities.serverId, serverId));
    expect(rows.find((row) => row.fingerprint === firstKey.fingerprint)?.status).toBe("superseded");

    const [audit] = await db
      .select()
      .from(auditEntries)
      .where(eq(auditEntries.action, "server.ssh-host-identity.rotate"));
    expect(audit.metadata).toMatchObject({
      oldFingerprint: firstKey.fingerprint,
      newFingerprint: nextKey.fingerprint
    });
  });

  it("does not reveal or approve a host identity across team boundaries", async () => {
    await discoverServerSshHostIdentities({
      serverId,
      teamId,
      scan: () => Promise.resolve([observedKey("AQIDBA==")])
    });
    const state = await listServerSshHostIdentities(serverId, teamId);
    if (!state) throw new Error("Expected host identity state.");
    const identity = state.identities[0];
    if (!identity) throw new Error("Expected observed host identity.");
    const result = await approveServerSshHostIdentity({
      serverId,
      teamId: "team_other",
      selection: selection(identity),
      actor
    });

    expect(await listServerSshHostIdentities(serverId, "team_other")).toBeNull();
    expect(result.status).toBe("not_found");
  });
});
