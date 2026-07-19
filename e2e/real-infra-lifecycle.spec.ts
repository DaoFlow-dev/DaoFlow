import { test, type Page } from "@playwright/test";
import {
  assertRealInfraControlPlaneRecordsRemoved,
  deleteRealInfraBackupHistory
} from "../packages/server/src/db/real-infra-cleanup";
import { realInfraTrpc } from "./fixtures/real-infra/api";
import { assertCleanupMutationAudit } from "./fixtures/real-infra/audit";
import { RealInfraArtifacts } from "./fixtures/real-infra/artifacts";
import { loadRealInfraConfig, sensitiveConfigValues } from "./fixtures/real-infra/config";
import {
  executeLifecycle,
  type LifecycleEvidence,
  type RealInfraLifecycleState
} from "./fixtures/real-infra/lifecycle";
import { realInfraNames } from "./fixtures/real-infra/names";
import { assertZeroOwnedRemote, cleanupOwnedRemote } from "./fixtures/real-infra/remote";
import { assertZeroOwnedS3, cleanupOwnedS3 } from "./fixtures/real-infra/s3";
import { PinnedSshSession } from "./fixtures/real-infra/ssh";

test.describe.configure({ mode: "serial" });

test("runs the isolated remote deploy, failure, rollback, backup, and restore lifecycle", async ({
  page
}) => {
  test.setTimeout(540_000);
  const config = loadRealInfraConfig();
  const names = realInfraNames(config.runToken);
  const artifacts = new RealInfraArtifacts(config.artifactDir, sensitiveConfigValues(config));
  const session = new PinnedSshSession(config);
  const state: RealInfraLifecycleState = {};
  let lifecyclePassed = false;
  let lifecycleFailed = false;
  let cleanupFailed = false;
  let evidence: LifecycleEvidence | undefined;

  await artifacts.prepare();
  try {
    await session.start();
    evidence = await executeLifecycle({ page, config, names, session, artifacts, state });
    lifecyclePassed = true;
  } catch (error) {
    lifecycleFailed = true;
    throw error;
  } finally {
    const cleanupFailures: CleanupFailure[] = [];
    await attemptCleanup(artifacts, cleanupFailures, "control-plane", () =>
      cleanupControlPlane(page, state, artifacts)
    );
    if (lifecyclePassed) {
      await attemptCleanup(artifacts, cleanupFailures, "audit", () =>
        assertCleanupMutationAudit(page)
      );
    }
    await attemptCleanup(artifacts, cleanupFailures, "remote", () =>
      cleanupOwnedRemote(session, config, names)
    );
    await attemptCleanup(artifacts, cleanupFailures, "remote-zero", () =>
      assertZeroOwnedRemote(session, config, names)
    );
    await attemptCleanup(artifacts, cleanupFailures, "s3", () => cleanupOwnedS3(config));
    await attemptCleanup(artifacts, cleanupFailures, "s3-zero", () => assertZeroOwnedS3(config));
    try {
      if (cleanupFailures.length > 0) {
        throw new Error("Real-infrastructure cleanup did not complete.");
      }
      await artifacts.cleanup("passed", {
        markerRechecked: true,
        controlPlaneRecordsRemoved: true,
        remoteResourcesZero: true,
        s3PrefixZero: true
      });
    } catch {
      cleanupFailed = true;
      await artifacts.cleanup("failed", { completed: false, failedSteps: cleanupFailures });
    } finally {
      await session.stop();
    }
    await artifacts.result(lifecyclePassed && !cleanupFailed ? "passed" : "failed", {
      runToken: config.runToken,
      lifecyclePassed,
      evidence
    });
    if (cleanupFailed && !lifecycleFailed) {
      throw new Error(
        "Real-infrastructure cleanup did not reach the required zero-resource state."
      );
    }
  }
});

async function attemptCleanup(
  artifacts: RealInfraArtifacts,
  failures: CleanupFailure[],
  name: string,
  action: () => Promise<void>
): Promise<void> {
  try {
    await action();
    await artifacts.outcome(`cleanup-${name}`, "passed");
  } catch (error) {
    const reason = cleanupFailureReason(error);
    failures.push({ name, reason });
    await artifacts.outcome(`cleanup-${name}`, "failed", { reason });
  }
}

interface CleanupFailure {
  name: string;
  reason: string;
  resourceIds?: string[];
}

function cleanupFailureReason(error: unknown): string {
  return error instanceof Error ? error.message : "Cleanup failed with a non-error value.";
}

async function cleanupControlPlane(
  page: Page,
  state: RealInfraLifecycleState,
  artifacts: RealInfraArtifacts
): Promise<void> {
  const failures: CleanupFailure[] = [];
  try {
    await deleteRealInfraBackupHistory({
      backupRunId: state.backupRunId,
      restoreId: state.restoreId
    });
    await artifacts.outcome("cleanup-backup-history", "passed");
  } catch (error) {
    const failure = cleanupResourceFailure("backup-history", error, [
      state.backupRunId,
      state.restoreId
    ]);
    failures.push(failure);
    await artifacts.outcome("cleanup-backup-history", "failed", failure);
  }
  const operations: Array<[string, Record<string, unknown>]> = [
    ["deleteBackupPolicy", { policyId: state.policyId }],
    ["deleteVolume", { volumeId: state.volumeId }],
    ["deleteBackupDestination", { id: state.destinationId }],
    ["deleteService", { serviceId: state.serviceId }],
    ["deleteEnvironment", { environmentId: state.environmentId }],
    ["deleteProject", { projectId: state.projectId }],
    ["deleteServer", { serverId: state.serverId }]
  ];
  for (const [procedure, input] of operations) {
    if (Object.values(input).some((value) => typeof value !== "string" || value.length === 0)) {
      continue;
    }
    const resourceIds = Object.values(input).filter(
      (value): value is string => typeof value === "string" && value.length > 0
    );
    try {
      await realInfraTrpc(page, procedure, input);
      await artifacts.outcome(`cleanup-${procedure}`, "passed", { resourceIds });
    } catch (error) {
      const failure = cleanupResourceFailure(procedure, error, resourceIds);
      failures.push(failure);
      await artifacts.outcome(`cleanup-${procedure}`, "failed", failure);
    }
  }
  try {
    await assertRealInfraControlPlaneRecordsRemoved(state);
    await artifacts.outcome("cleanup-control-plane-zero", "passed");
  } catch (error) {
    const failure = cleanupResourceFailure("control-plane-zero", error, stateResourceIds(state));
    failures.push(failure);
    await artifacts.outcome("cleanup-control-plane-zero", "failed", failure);
  }
  if (failures.length > 0) {
    throw new Error(
      `Control-plane cleanup did not complete: ${failures.map(formatCleanupFailure).join("; ")}`
    );
  }
}

function cleanupResourceFailure(
  name: string,
  error: unknown,
  resourceIds: Array<string | undefined>
): CleanupFailure {
  return {
    name,
    reason: cleanupFailureReason(error),
    resourceIds: resourceIds.filter((value): value is string => Boolean(value))
  };
}

function stateResourceIds(state: RealInfraLifecycleState): string[] {
  return Object.values(state).filter(
    (value): value is string => typeof value === "string" && value.length > 0
  );
}

function formatCleanupFailure(failure: CleanupFailure): string {
  const resources = failure.resourceIds?.length ? ` [${failure.resourceIds.join(", ")}]` : "";
  return `${failure.name}${resources}: ${failure.reason}`;
}
