import { describe, expect, test } from "bun:test";

import { assertRecoveredControlPlaneIntegrity } from "./control-plane-recovery-restore-integrity";
import type { RecoveryDatabaseEvidence } from "./control-plane-recovery-restore-types";
import type { RecoveredControlPlaneEvidence } from "./control-plane-recovery-restore-verification";

const fingerprint = "a".repeat(64);

function databaseEvidence(): RecoveryDatabaseEvidence {
  return {
    teams: 2,
    users: 2,
    userIdentities: 1,
    teamMembers: 2,
    projects: 2,
    servers: 2,
    auditEntries: 3,
    backupPolicies: 2,
    backupRuns: 2,
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
      { id: "project_b", teamId: "team_b" }
    ],
    serversById: [
      { id: "server_a", teamId: "team_a" },
      { id: "server_b", teamId: "team_b" }
    ],
    backupPoliciesById: [
      { id: "policy_a", teamId: "team_a" },
      { id: "policy_b", teamId: "team_b" }
    ],
    backupRunsById: [
      { id: "run_a", policyId: "policy_a" },
      { id: "run_b", policyId: "policy_b" }
    ],
    verificationPrincipal: {
      id: "user_a",
      email: "owner@example.test",
      role: "owner",
      activeTeamId: "team_a"
    }
  };
}

function controlPlaneEvidence(): RecoveredControlPlaneEvidence {
  return {
    viewer: { email: "owner@example.test", role: "owner" },
    projectIds: ["project_a"],
    serverIds: ["server_a"],
    auditEntries: 3,
    backupPolicyIds: ["policy_a"],
    backupRunIds: ["run_a"]
  };
}

describe("post-start recovery integrity", () => {
  test("verifies the active team without confusing global multi-team counts", () => {
    const restored = databaseEvidence();
    expect(() =>
      assertRecoveredControlPlaneIntegrity({
        restored,
        restarted: databaseEvidence(),
        controlPlane: controlPlaneEvidence()
      })
    ).not.toThrow();
  });

  test("rejects a lost restored server replaced by another identifier", () => {
    const controlPlane = controlPlaneEvidence();
    controlPlane.serverIds = ["server_local"];
    expect(() =>
      assertRecoveredControlPlaneIntegrity({
        restored: databaseEvidence(),
        restarted: databaseEvidence(),
        controlPlane
      })
    ).toThrow("identities and permissions");
  });

  test("rejects a changed recovered role", () => {
    const controlPlane = controlPlaneEvidence();
    controlPlane.viewer.role = "viewer";
    expect(() =>
      assertRecoveredControlPlaneIntegrity({
        restored: databaseEvidence(),
        restarted: databaseEvidence(),
        controlPlane
      })
    ).toThrow("identities and permissions");
  });
});
