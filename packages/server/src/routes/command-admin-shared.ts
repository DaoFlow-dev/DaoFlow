import { TRPCError } from "@trpc/server";
import { resolveTeamIdForUser } from "../db/services/teams";

export async function requireActorTeamId(userId: string) {
  const teamId = await resolveTeamIdForUser(userId);
  if (!teamId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No organization is available for this user."
    });
  }

  return teamId;
}
