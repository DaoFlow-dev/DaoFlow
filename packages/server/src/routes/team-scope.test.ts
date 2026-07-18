import { beforeEach, describe, expect, it } from "vitest";
import { resetTestDatabaseWithControlPlane } from "../test-db";
import { requireApprovalDecisionTeamId } from "./team-scope";

describe("approval decision team scope", () => {
  beforeEach(async () => {
    await resetTestDatabaseWithControlPlane();
  });

  it("accepts owner and admin memberships in the active team", async () => {
    await expect(requireApprovalDecisionTeamId("user_foundation_owner")).resolves.toBe(
      "team_foundation"
    );
    await expect(requireApprovalDecisionTeamId("user_foundation_operator")).resolves.toBe(
      "team_foundation"
    );
  });

  it("rejects ordinary members even when their application role can operate deployments", async () => {
    await expect(requireApprovalDecisionTeamId("user_developer")).rejects.toMatchObject({
      code: "FORBIDDEN"
    });
  });

  it("rejects users without a team membership", async () => {
    await expect(requireApprovalDecisionTeamId("missing-user")).rejects.toMatchObject({
      code: "PRECONDITION_FAILED"
    });
  });
});
