import { TRPCError } from "@trpc/server";
import { resolveMemberTeamIdForUser } from "../db/services/teams";

export async function requireActorTeamId(userId: string) {
  const teamId = await resolveMemberTeamIdForUser(userId);
  if (!teamId) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No organization membership is available for this user."
    });
  }

  return teamId;
}
