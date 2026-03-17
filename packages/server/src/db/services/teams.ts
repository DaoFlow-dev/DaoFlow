import { asc, eq } from "drizzle-orm";
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
