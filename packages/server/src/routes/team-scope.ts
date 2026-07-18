import { TRPCError } from "@trpc/server";
import { resolveMemberTeamForUser, resolveMemberTeamIdForUser } from "../db/services/teams";

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

export async function requireApprovalDecisionTeamId(userId: string) {
  const membership = await resolveMemberTeamForUser(userId);
  if (!membership) {
    throw new TRPCError({
      code: "PRECONDITION_FAILED",
      message: "No organization membership is available for this user."
    });
  }
  if (membership.role !== "owner" && membership.role !== "admin") {
    throw new TRPCError({
      code: "FORBIDDEN",
      message: "Approval decisions require owner or admin membership in the active organization."
    });
  }

  return membership.teamId;
}
