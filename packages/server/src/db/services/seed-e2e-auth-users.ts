import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { auth } from "../../auth";
import { db, pool } from "../connection";
import { users } from "../schema/users";
import { teamInvites, teamMembers, teams } from "../schema/teams";
import { e2eAuthUsers, type E2EAuthUser } from "../../testing/e2e-auth-users";
import { acceptPendingTeamInviteForEmail } from "./member-access";

const foundationTeamId = "team_foundation";

function inviteRoleForUser(user: E2EAuthUser) {
  return user.role === "owner" ? "admin" : user.role;
}

function membershipRoleForUser(user: E2EAuthUser) {
  if (user.role === "owner" || user.role === "admin") {
    return user.role;
  }
  return "member";
}

async function ensureE2EAuthInvite(user: E2EAuthUser) {
  const [foundationTeam] = await db
    .select({ id: teams.id, createdByUserId: teams.createdByUserId })
    .from(teams)
    .where(eq(teams.id, foundationTeamId))
    .limit(1);

  if (!foundationTeam?.createdByUserId) {
    return;
  }

  await db.insert(teamInvites).values({
    id: `inv_e2e_${randomUUID().replaceAll("-", "").slice(0, 24)}`,
    teamId: foundationTeam.id,
    email: user.email,
    role: inviteRoleForUser(user),
    status: "pending",
    inviterId: foundationTeam.createdByUserId,
    createdAt: new Date(),
    expiresAt: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)
  });
}

async function ensureE2EAuthUser(user: E2EAuthUser) {
  const [existingUser] = await db
    .select({ id: users.id })
    .from(users)
    .where(eq(users.email, user.email))
    .limit(1);

  if (!existingUser) {
    await ensureE2EAuthInvite(user);
    await auth.api.signUpEmail({
      body: {
        name: user.name,
        email: user.email,
        password: user.password
      }
    });
    await acceptPendingTeamInviteForEmail(user.email);
  }

  const [resolvedUser] = await db
    .update(users)
    .set({
      name: user.name,
      emailVerified: true,
      role: user.role,
      defaultTeamId: foundationTeamId,
      status: "active",
      updatedAt: new Date()
    })
    .where(eq(users.email, user.email))
    .returning({ id: users.id });

  if (!resolvedUser) {
    throw new Error(`Failed to resolve E2E auth user ${user.email}.`);
  }

  const [membership] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.teamId, foundationTeamId), eq(teamMembers.userId, resolvedUser.id)))
    .limit(1);
  const membershipRole = membershipRoleForUser(user);

  if (membership) {
    await db
      .update(teamMembers)
      .set({ role: membershipRole })
      .where(eq(teamMembers.id, membership.id));
  } else {
    await db.insert(teamMembers).values({
      teamId: foundationTeamId,
      userId: resolvedUser.id,
      role: membershipRole,
      createdAt: new Date()
    });
  }
}

async function main() {
  for (const user of e2eAuthUsers) {
    await ensureE2EAuthUser(user);
  }

  console.log(`Seeded Better Auth E2E users: ${e2eAuthUsers.map((user) => user.email).join(", ")}`);
}

main()
  .then(async () => {
    await pool.end();
    process.exit(0);
  })
  .catch(async (error) => {
    console.error(error);
    await pool.end().catch(() => undefined);
    process.exit(1);
  });
