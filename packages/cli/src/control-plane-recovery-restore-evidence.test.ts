import { describe, expect, test } from "bun:test";

import {
  assertRecoveryDatabaseEvidence,
  assertRecoveryIdentityPreserved,
  buildRecoveryEvidenceSql
} from "./control-plane-recovery-restore-evidence";
import type { RecoveryDatabaseEvidence } from "./control-plane-recovery-restore-types";

const fingerprint = "a".repeat(64);

function evidence(): RecoveryDatabaseEvidence {
  return {
    teams: 1,
    users: 1,
    userIdentities: 1,
    teamMembers: 1,
    projects: 2,
    servers: 1,
    auditEntries: 3,
    backupPolicies: 1,
    backupRuns: 1,
    orphanTeamMembers: 0,
    orphanProjects: 0,
    orphanServers: 0,
    fingerprints: {
      teams: fingerprint,
      users: fingerprint,
      userIdentities: fingerprint,
      teamMembers: fingerprint,
      projects: fingerprint,
      auditEntries: fingerprint,
      backupPolicies: fingerprint,
      backupRuns: fingerprint
    },
    projectsById: [
      { id: "project_a", teamId: "team_a" },
      { id: "project_b", teamId: "team_a" }
    ],
    serversById: [{ id: "server_a", teamId: "team_a" }],
    backupPoliciesById: [{ id: "policy_a", teamId: "team_a" }],
    backupRunsById: [{ id: "run_a", policyId: "policy_a" }],
    verificationPrincipal: {
      id: "user_a",
      email: "owner@example.test",
      role: "owner",
      activeTeamId: "team_a"
    }
  };
}

describe("control-plane recovery database evidence", () => {
  test("builds identity and permission fingerprints without interpolating raw SQL", () => {
    const sql = buildRecoveryEvidenceSql("owner'o@example.test");
    expect(sql).toContain("owner''o@example.test");
    expect(sql).toContain("team_members");
    expect(sql).toContain("backup_policies");
    expect(sql).toContain("retention_monthly");
    expect(sql).toContain("temporal_workflow_id");
    expect(sql).toContain("sha256");
  });

  test("accepts complete identity evidence", () => {
    expect(assertRecoveryDatabaseEvidence(evidence())).toEqual(evidence());
  });

  test("allows a startup-added server while preserving every restored server", () => {
    const restored = evidence();
    const restarted = evidence();
    restarted.servers = 2;
    restarted.serversById.push({ id: "server_local", teamId: "team_a" });
    expect(() => assertRecoveryIdentityPreserved(restored, restarted)).not.toThrow();
  });

  test("rejects a restored server replaced by a different startup server", () => {
    const restored = evidence();
    const restarted = evidence();
    restarted.serversById = [{ id: "server_local", teamId: "team_a" }];
    expect(() => assertRecoveryIdentityPreserved(restored, restarted)).toThrow(
      "changed or missing restored identities"
    );
  });

  test("rejects changed roles or memberships after startup", () => {
    const restored = evidence();
    const restarted = evidence();
    restarted.fingerprints.teamMembers = "b".repeat(64);
    expect(() => assertRecoveryIdentityPreserved(restored, restarted)).toThrow(
      "changed or missing restored identities"
    );
  });
});
