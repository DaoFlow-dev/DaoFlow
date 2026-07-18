import { and, asc, eq } from "drizzle-orm";
import { db } from "../connection";
import { teamMembers } from "../schema/teams";
import { users } from "../schema/users";

/** Resolve the active team only from a real membership. */
export async function resolveTeamIdForUser(userId: string): Promise<string | null> {
  return resolveMemberTeamIdForUser(userId);
}

export async function resolveMemberTeamForUser(
  userId: string
): Promise<{ teamId: string; role: string } | null> {
  const [preferredMembership] = await db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(users)
    .innerJoin(
      teamMembers,
      and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, users.defaultTeamId))
    )
    .where(eq(users.id, userId))
    .limit(1);

  if (preferredMembership?.teamId) {
    return preferredMembership;
  }

  const [membership] = await db
    .select({ teamId: teamMembers.teamId, role: teamMembers.role })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teamMembers.createdAt))
    .limit(1);

  return membership ?? null;
}

/**
 * Resolve a user's active team only when the user is actually a member.
 * Prefer the default team when it is still backed by a membership, then use
 * the oldest real membership as the deterministic fallback.
 */
export async function resolveMemberTeamIdForUser(userId: string): Promise<string | null> {
  return (await resolveMemberTeamForUser(userId))?.teamId ?? null;
}

export async function isUserMemberOfTeam(userId: string, teamId: string): Promise<boolean> {
  const [membership] = await db
    .select({ id: teamMembers.id })
    .from(teamMembers)
    .where(and(eq(teamMembers.userId, userId), eq(teamMembers.teamId, teamId)))
    .limit(1);

  return Boolean(membership);
}
