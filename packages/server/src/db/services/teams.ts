import { and, asc, eq } from "drizzle-orm";
import { db } from "../connection";
import { teams, teamMembers } from "../schema/teams";
import { users } from "../schema/users";

/**
 * Resolve the active team for the current single-team control plane.
 *
 * The product is not truly multi-tenant yet, so signed-up users may not have
 * a default team or membership row. In that case we fall back to the first
 * available team instead of hardcoding an invalid sentinel like "default".
 */
export async function resolveTeamIdForUser(userId: string): Promise<string | null> {
  const [user] = await db
    .select({ defaultTeamId: users.defaultTeamId })
    .from(users)
    .where(eq(users.id, userId))
    .limit(1);

  if (user?.defaultTeamId) {
    return user.defaultTeamId;
  }

  const [membership] = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .limit(1);

  if (membership?.teamId) {
    return membership.teamId;
  }

  const [fallbackTeam] = await db
    .select({ id: teams.id })
    .from(teams)
    .orderBy(asc(teams.createdAt))
    .limit(1);

  return fallbackTeam?.id ?? null;
}

/**
 * Resolve a user's active team only when the user is actually a member.
 * Read surfaces that expose team-owned operational data must not use the
 * single-team fallback above, because it can select another team's data.
 */
export async function resolveMemberTeamIdForUser(userId: string): Promise<string | null> {
  const [preferredMembership] = await db
    .select({ teamId: teamMembers.teamId })
    .from(users)
    .innerJoin(
      teamMembers,
      and(eq(teamMembers.userId, users.id), eq(teamMembers.teamId, users.defaultTeamId))
    )
    .where(eq(users.id, userId))
    .limit(1);

  if (preferredMembership?.teamId) {
    return preferredMembership.teamId;
  }

  const [membership] = await db
    .select({ teamId: teamMembers.teamId })
    .from(teamMembers)
    .where(eq(teamMembers.userId, userId))
    .orderBy(asc(teamMembers.createdAt))
    .limit(1);

  return membership?.teamId ?? null;
}
