import { and, eq } from "drizzle-orm";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { auth } from "./auth";
import {
  ensureInitialOwnerFromEnv,
  resetInitialOwnerBootstrapState
} from "./bootstrap-initial-owner";
import {
  ensureLocalhostServer,
  resetLocalhostServerBootstrapState
} from "./bootstrap-localhost-server";
import { db } from "./db/connection";
import { servers } from "./db/schema/servers";
import { teamMembers, teams } from "./db/schema/teams";
import { users } from "./db/schema/users";
import { resolveTeamIdForUser } from "./db/services/teams";
import { resetTestDatabase } from "./test-db";

const INITIAL_OWNER_EMAIL_ENV = "DAOFLOW_INITIAL_ADMIN_EMAIL";
const INITIAL_OWNER_PASSWORD_ENV = "DAOFLOW_INITIAL_ADMIN_PASSWORD";

describe("bootstrapInitialOwner", () => {
  let originalEmail: string | undefined;
  let originalPassword: string | undefined;

  beforeEach(async () => {
    originalEmail = process.env[INITIAL_OWNER_EMAIL_ENV];
    originalPassword = process.env[INITIAL_OWNER_PASSWORD_ENV];
    delete process.env[INITIAL_OWNER_EMAIL_ENV];
    delete process.env[INITIAL_OWNER_PASSWORD_ENV];
    await resetTestDatabase();
    resetInitialOwnerBootstrapState();
    resetLocalhostServerBootstrapState();
  });

  afterEach(() => {
    if (originalEmail === undefined) {
      delete process.env[INITIAL_OWNER_EMAIL_ENV];
    } else {
      process.env[INITIAL_OWNER_EMAIL_ENV] = originalEmail;
    }

    if (originalPassword === undefined) {
      delete process.env[INITIAL_OWNER_PASSWORD_ENV];
    } else {
      process.env[INITIAL_OWNER_PASSWORD_ENV] = originalPassword;
    }

    resetInitialOwnerBootstrapState();
    resetLocalhostServerBootstrapState();
  });

  it("creates an immediately usable owner team and claims localhost during startup", async () => {
    const email = "bootstrap-owner@daoflow.local";
    process.env[INITIAL_OWNER_EMAIL_ENV] = email;
    process.env[INITIAL_OWNER_PASSWORD_ENV] = "bootstrap-secret-2026";

    await db.insert(servers).values({
      id: "srv_bootstrap_localhost",
      name: "bootstrap-localhost",
      host: "localhost",
      region: "local",
      sshPort: 22,
      kind: "docker-engine",
      status: "ready",
      metadata: {},
      updatedAt: new Date()
    });

    await ensureInitialOwnerFromEnv();

    const [owner] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(owner).toMatchObject({ role: "owner" });
    if (!owner) {
      throw new Error("Initial owner was not created");
    }

    const ownerTeams = await db.select().from(teams).where(eq(teams.createdByUserId, owner.id));
    expect(ownerTeams).toHaveLength(1);

    const team = ownerTeams[0];
    if (!team) {
      throw new Error("Initial owner team was not created");
    }
    const [membership] = await db
      .select()
      .from(teamMembers)
      .where(and(eq(teamMembers.teamId, team.id), eq(teamMembers.userId, owner.id)))
      .limit(1);

    expect(membership).toMatchObject({ role: "owner" });
    expect(owner.defaultTeamId).toBe(team.id);
    expect(await resolveTeamIdForUser(owner.id)).toBe(team.id);

    await ensureLocalhostServer();

    const [localhost] = await db
      .select()
      .from(servers)
      .where(eq(servers.id, "srv_bootstrap_localhost"))
      .limit(1);
    if (!localhost) {
      throw new Error("Localhost server was not found");
    }
    expect(localhost.teamId).toBe(team.id);
  });

  it("repairs the legacy owner state and remains idempotent after restart", async () => {
    const email = "legacy-bootstrap-owner@daoflow.local";
    process.env[INITIAL_OWNER_EMAIL_ENV] = email;
    process.env[INITIAL_OWNER_PASSWORD_ENV] = "bootstrap-secret-2026";

    await auth.api.signUpEmail({
      body: {
        name: "DaoFlow Owner",
        email,
        password: "bootstrap-secret-2026"
      }
    });

    const [legacyOwner] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    expect(legacyOwner).toMatchObject({ role: "owner", defaultTeamId: null });
    if (!legacyOwner) {
      throw new Error("Legacy initial owner was not created");
    }
    expect(await resolveTeamIdForUser(legacyOwner.id)).toBeNull();

    await ensureInitialOwnerFromEnv();

    const [repairedOwner] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!repairedOwner) {
      throw new Error("Legacy initial owner was not repaired");
    }
    const repairedTeams = await db
      .select()
      .from(teams)
      .where(eq(teams.createdByUserId, repairedOwner.id));
    expect(repairedTeams).toHaveLength(1);
    const repairedTeam = repairedTeams[0];
    if (!repairedTeam) {
      throw new Error("Legacy initial owner was not repaired");
    }

    resetInitialOwnerBootstrapState();
    await ensureInitialOwnerFromEnv();

    const [restartedOwner] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!restartedOwner) {
      throw new Error("Legacy initial owner was not found after restart");
    }
    const restartedTeams = await db
      .select()
      .from(teams)
      .where(eq(teams.createdByUserId, restartedOwner.id));
    const memberships = await db
      .select()
      .from(teamMembers)
      .where(
        and(eq(teamMembers.teamId, repairedTeam.id), eq(teamMembers.userId, restartedOwner.id))
      );

    expect(restartedTeams).toHaveLength(1);
    expect(restartedOwner.defaultTeamId).toBe(repairedTeam.id);
    expect(memberships).toHaveLength(1);
    expect(memberships[0]).toMatchObject({ role: "owner" });
  });

  it("preserves a valid default membership instead of selecting an older owner-created team", async () => {
    const email = "existing-default-owner@daoflow.local";
    process.env[INITIAL_OWNER_EMAIL_ENV] = email;
    process.env[INITIAL_OWNER_PASSWORD_ENV] = "bootstrap-secret-2026";

    await auth.api.signUpEmail({
      body: {
        name: "DaoFlow Owner",
        email,
        password: "bootstrap-secret-2026"
      }
    });

    const [owner] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!owner) {
      throw new Error("Owner for default-team regression was not created");
    }

    await db.insert(teams).values([
      {
        id: "team_owner_older",
        name: "Older Owner Team",
        createdByUserId: owner.id,
        createdAt: new Date("2026-01-01T00:00:00.000Z"),
        updatedAt: new Date("2026-01-01T00:00:00.000Z")
      },
      {
        id: "team_owner_preferred",
        name: "Preferred Owner Team",
        createdByUserId: owner.id,
        createdAt: new Date("2026-02-01T00:00:00.000Z"),
        updatedAt: new Date("2026-02-01T00:00:00.000Z")
      }
    ]);
    await db.insert(teamMembers).values([
      { teamId: "team_owner_older", userId: owner.id, role: "owner" },
      { teamId: "team_owner_preferred", userId: owner.id, role: "owner" }
    ]);
    await db
      .update(users)
      .set({ defaultTeamId: "team_owner_preferred", updatedAt: new Date() })
      .where(eq(users.id, owner.id));

    await ensureInitialOwnerFromEnv();

    const [reconciledOwner] = await db.select().from(users).where(eq(users.id, owner.id)).limit(1);
    const ownerTeams = await db.select().from(teams).where(eq(teams.createdByUserId, owner.id));

    expect(reconciledOwner?.defaultTeamId).toBe("team_owner_preferred");
    expect(ownerTeams).toHaveLength(2);
  });

  it("falls back to the oldest existing membership deterministically", async () => {
    const email = "membership-fallback-owner@daoflow.local";
    process.env[INITIAL_OWNER_EMAIL_ENV] = email;
    process.env[INITIAL_OWNER_PASSWORD_ENV] = "bootstrap-secret-2026";

    await auth.api.signUpEmail({
      body: {
        name: "DaoFlow Owner",
        email,
        password: "bootstrap-secret-2026"
      }
    });

    const [owner] = await db.select().from(users).where(eq(users.email, email)).limit(1);
    if (!owner) {
      throw new Error("Owner for membership fallback was not created");
    }

    await db.insert(teams).values([
      { id: "team_membership_first", name: "First Membership" },
      { id: "team_membership_second", name: "Second Membership" }
    ]);
    const joinedAt = new Date("2026-03-01T00:00:00.000Z");
    await db.insert(teamMembers).values([
      {
        id: 8202,
        teamId: "team_membership_second",
        userId: owner.id,
        role: "member",
        createdAt: joinedAt
      },
      {
        id: 8201,
        teamId: "team_membership_first",
        userId: owner.id,
        role: "member",
        createdAt: joinedAt
      }
    ]);

    await ensureInitialOwnerFromEnv();

    const [reconciledOwner] = await db.select().from(users).where(eq(users.id, owner.id)).limit(1);
    const memberships = await db.select().from(teamMembers).where(eq(teamMembers.userId, owner.id));

    expect(reconciledOwner?.defaultTeamId).toBe("team_membership_first");
    expect(memberships).toHaveLength(2);
  });
});
