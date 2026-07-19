import type { RecoveryDatabaseEvidence } from "./control-plane-recovery-restore-types";
import type { RecoveredControlPlaneEvidence } from "./control-plane-recovery-restore-verification";
import { assertRecoveryIdentityPreserved } from "./control-plane-recovery-restore-evidence";

function sorted(values: Iterable<string>): string[] {
  return [...values].sort();
}

function sameIds(actual: readonly string[], expected: readonly string[]): boolean {
  return JSON.stringify(sorted(actual)) === JSON.stringify(sorted(expected));
}

export function assertRecoveredControlPlaneIntegrity(input: {
  restored: RecoveryDatabaseEvidence;
  restarted: RecoveryDatabaseEvidence;
  controlPlane: RecoveredControlPlaneEvidence;
}): void {
  assertRecoveryIdentityPreserved(input.restored, input.restarted);
  const principal = input.restored.verificationPrincipal;
  const activeTeamId = principal.activeTeamId;
  const expectedProjectIds = input.restarted.projectsById
    .filter((project) => project.teamId === activeTeamId)
    .map((project) => project.id);
  const expectedServerIds = input.restarted.serversById
    .filter((server) => server.teamId === activeTeamId)
    .map((server) => server.id);
  const expectedPolicyIds = input.restarted.backupPoliciesById
    .filter((policy) => policy.teamId === activeTeamId)
    .map((policy) => policy.id);
  const expectedPolicySet = new Set(expectedPolicyIds);
  const expectedRunIds = input.restarted.backupRunsById
    .filter((run) => expectedPolicySet.has(run.policyId))
    .map((run) => run.id);
  const actualRunIds = input.controlPlane.backupRunIds;
  const visibleRunsMatch =
    expectedRunIds.length <= 50
      ? sameIds(actualRunIds, expectedRunIds)
      : actualRunIds.length === 50 &&
        new Set(actualRunIds).size === actualRunIds.length &&
        actualRunIds.every((id) => expectedRunIds.includes(id));

  if (
    input.controlPlane.viewer.email.toLowerCase() !== principal.email ||
    input.controlPlane.viewer.role !== principal.role ||
    !sameIds(input.controlPlane.projectIds, expectedProjectIds) ||
    !sameIds(input.controlPlane.serverIds, expectedServerIds) ||
    !sameIds(input.controlPlane.backupPolicyIds, expectedPolicyIds) ||
    !visibleRunsMatch ||
    input.controlPlane.auditEntries !== input.restarted.auditEntries
  ) {
    throw new Error(
      "Post-start recovery verification does not match restored identities and permissions."
    );
  }
}
