import { readFileSync } from "node:fs";
import { join } from "node:path";

import { waitForInstallHealth } from "./install-health";
import { inferInstallWorkflowProfile } from "./install-workflow-profile";
import { parseEnvFile } from "./templates";
import type { ControlPlaneRecoveryRestoreInspection } from "./control-plane-recovery-restore-types";
import {
  buildRecoveryEnvironment,
  isRecoveryEnvironmentCurrent,
  redactRecoveryRestoreError,
  writeRecoveryConfigSnapshot,
  writeRecoveryEnvironmentAtomically,
  type RecoveryRestoreRedactionInput
} from "./control-plane-recovery-restore-config";
import {
  createRecoveryDatabase,
  getComposeContainerId,
  isContainerRunning,
  readRecoveryDatabaseEvidence,
  readRecoveryMigrationJournal,
  readRecoveryPostgresVersion,
  recoveryRestoreRuntime,
  requireRecoveryPostgres,
  restoreRecoveryDump,
  runRecoveryMigrations,
  startRecoveryControlPlane,
  stopRecoveryControlPlane,
  type RecoveryDatabaseEvidence,
  type RecoveryRestoreRuntime
} from "./control-plane-recovery-restore-runtime";
import {
  verifyRecoveredControlPlane,
  type RecoveredControlPlaneEvidence
} from "./control-plane-recovery-restore-verification";
import { assertRecoveredControlPlaneIntegrity } from "./control-plane-recovery-restore-integrity";

export interface ControlPlaneRecoveryRestoreResult {
  status: "restored";
  bundleId: string;
  previousDatabase: string;
  restoredDatabase: string;
  previousConfigPath: string;
  databaseEvidence: RecoveryDatabaseEvidence;
  controlPlaneEvidence: RecoveredControlPlaneEvidence;
  rollback: {
    databaseRetained: true;
    configRetained: true;
  };
}

export const controlPlaneRecoveryRestoreExecutionDependencies = {
  stopControlPlane: stopRecoveryControlPlane,
  startControlPlane: startRecoveryControlPlane,
  requirePostgres: requireRecoveryPostgres,
  createDatabase: createRecoveryDatabase,
  restoreDump: restoreRecoveryDump,
  readMigrationJournal: readRecoveryMigrationJournal,
  readPostgresVersion: readRecoveryPostgresVersion,
  runMigrations: runRecoveryMigrations,
  readDatabaseEvidence: readRecoveryDatabaseEvidence,
  verifyControlPlane: verifyRecoveredControlPlane,
  waitForHealth: waitForInstallHealth,
  inspectRollbackState: inspectRecoveryRollbackState,
  writeEnvironment: writeRecoveryEnvironmentAtomically
};

type RecoveryExecutionDependencies = typeof controlPlaneRecoveryRestoreExecutionDependencies;

type RecoveryRollbackState = {
  controlPlaneRunning: boolean;
  configMatchesOriginal: boolean;
};

export async function executeControlPlaneRecoveryRestore(
  inspection: ControlPlaneRecoveryRestoreInspection,
  runtime: RecoveryRestoreRuntime = recoveryRestoreRuntime,
  dependencies: RecoveryExecutionDependencies = controlPlaneRecoveryRestoreExecutionDependencies
): Promise<ControlPlaneRecoveryRestoreResult> {
  const installDir = inspection.plan.installation.directory;
  const envPath = join(installDir, ".env");
  const originalContents = readFileSync(envPath, "utf8");
  const originalEnv = parseEnvFile(originalContents);
  const postgresPassword = originalEnv.POSTGRES_PASSWORD?.trim();
  if (!postgresPassword)
    throw new Error("The clean installation POSTGRES_PASSWORD is unavailable.");

  const profile = inferInstallWorkflowProfile(originalEnv);
  const port = resolvePort(originalEnv);
  const targetDatabase = inspection.plan.databases.newDatabase;
  const databaseUrl = `postgresql://daoflow:${encodeURIComponent(postgresPassword)}@postgres:5432/${targetDatabase}`;
  const manifestSecrets = Object.fromEntries(
    inspection.manifest.requiredExternalSecrets.map((name) => [name, inspection.secrets[name]])
  );
  const restoredContents = buildRecoveryEnvironment({
    originalContents,
    targetDatabase,
    requiredExternalSecrets: inspection.manifest.requiredExternalSecrets,
    externalSecrets: inspection.secrets
  });
  const snapshotPath = writeRecoveryConfigSnapshot({
    installDir,
    originalContents,
    timestamp: runtime.now()
  });

  const redaction: RecoveryRestoreRedactionInput = {
    secrets: inspection.secrets,
    databasePasswords: [postgresPassword]
  };
  let stopAttempted = false;
  let configSwitchAttempted = false;
  try {
    stopAttempted = true;
    dependencies.stopControlPlane({ runtime, dir: installDir, envPath });
    const postgresContainer = dependencies.requirePostgres({ runtime, dir: installDir, envPath });
    assertPostgresCompatibility(
      dependencies.readPostgresVersion({ runtime, containerId: postgresContainer }),
      inspection.manifest.database.version
    );
    dependencies.createDatabase({
      runtime,
      containerId: postgresContainer,
      databaseName: targetDatabase
    });
    dependencies.restoreDump({
      runtime,
      containerId: postgresContainer,
      databaseName: targetDatabase,
      dumpPath: inspection.dumpPath,
      bundleId: inspection.manifest.bundleId
    });
    assertOriginalMigrationJournal(
      dependencies.readMigrationJournal({
        runtime,
        containerId: postgresContainer,
        databaseName: targetDatabase
      }),
      inspection.manifest.migrations.applied
    );
    dependencies.runMigrations({
      runtime,
      dir: installDir,
      envPath,
      databaseUrl,
      externalSecrets: manifestSecrets
    });
    const databaseEvidence = dependencies.readDatabaseEvidence({
      runtime,
      containerId: postgresContainer,
      databaseName: targetDatabase,
      verificationEmail: inspection.secrets.DAOFLOW_RECOVERY_VERIFY_EMAIL
    });

    configSwitchAttempted = true;
    dependencies.writeEnvironment(envPath, restoredContents);
    dependencies.startControlPlane({ runtime, dir: installDir, envPath });
    const controlPlaneEvidence = await dependencies.verifyControlPlane({
      runtime,
      port,
      workflowProfile: profile,
      email: inspection.secrets.DAOFLOW_RECOVERY_VERIFY_EMAIL,
      password: inspection.secrets.DAOFLOW_RECOVERY_VERIFY_PASSWORD
    });
    const restartedDatabaseEvidence = dependencies.readDatabaseEvidence({
      runtime,
      containerId: postgresContainer,
      databaseName: targetDatabase,
      verificationEmail: inspection.secrets.DAOFLOW_RECOVERY_VERIFY_EMAIL
    });
    assertRecoveredControlPlaneIntegrity({
      restored: databaseEvidence,
      restarted: restartedDatabaseEvidence,
      controlPlane: controlPlaneEvidence
    });

    return {
      status: "restored",
      bundleId: inspection.manifest.bundleId,
      previousDatabase: inspection.plan.databases.oldDatabase,
      restoredDatabase: targetDatabase,
      previousConfigPath: snapshotPath,
      databaseEvidence,
      controlPlaneEvidence,
      rollback: { databaseRetained: true, configRetained: true }
    };
  } catch (error) {
    const originalError = redactRecoveryRestoreError(error, redaction);
    const rollbackError = await rollbackControlPlane({
      runtime,
      installDir,
      envPath,
      originalContents,
      port,
      stopAttempted,
      configSwitchAttempted,
      redaction,
      dependencies
    });
    if (rollbackError) {
      throw new Error(
        `${originalError} Automatic rollback also failed: ${rollbackError}. Restore ${snapshotPath} to ${envPath} and recreate the daoflow service.`
      );
    }
    throw new Error(
      configSwitchAttempted
        ? `${originalError} The original configuration was restored and the previous database remains active.`
        : `${originalError} Switchover did not occur; the previous database remains active.`
    );
  }
}

async function rollbackControlPlane(input: {
  runtime: RecoveryRestoreRuntime;
  installDir: string;
  envPath: string;
  originalContents: string;
  port: number;
  stopAttempted: boolean;
  configSwitchAttempted: boolean;
  redaction: RecoveryRestoreRedactionInput;
  dependencies: RecoveryExecutionDependencies;
}): Promise<string | null> {
  try {
    const actualState = input.dependencies.inspectRollbackState({
      runtime: input.runtime,
      dir: input.installDir,
      envPath: input.envPath,
      originalContents: input.originalContents
    });
    const configChanged = input.configSwitchAttempted && !actualState.configMatchesOriginal;
    let shouldRestart = input.stopAttempted && !actualState.controlPlaneRunning;

    if (configChanged) {
      if (actualState.controlPlaneRunning) {
        try {
          input.dependencies.stopControlPlane({
            runtime: input.runtime,
            dir: input.installDir,
            envPath: input.envPath
          });
        } catch {
          // `up --force-recreate` below still re-applies the original configuration.
        }
      }
      input.dependencies.writeEnvironment(input.envPath, input.originalContents);
      shouldRestart = true;
    }
    if (shouldRestart) {
      input.dependencies.startControlPlane({
        runtime: input.runtime,
        dir: input.installDir,
        envPath: input.envPath
      });
      const healthy = await input.dependencies.waitForHealth({
        runtime: input.runtime,
        port: input.port,
        attempts: 15
      });
      if (!healthy) throw new Error("previous DaoFlow configuration did not become ready");
    }
    return null;
  } catch (error) {
    return redactRecoveryRestoreError(error, input.redaction);
  }
}

function inspectRecoveryRollbackState(input: {
  runtime: RecoveryRestoreRuntime;
  dir: string;
  envPath: string;
  originalContents: string;
}): RecoveryRollbackState {
  const containerId = getComposeContainerId({
    runtime: input.runtime,
    dir: input.dir,
    envPath: input.envPath,
    service: "daoflow"
  });
  return {
    controlPlaneRunning: isContainerRunning(input.runtime, containerId),
    configMatchesOriginal: isRecoveryEnvironmentCurrent(input.envPath, input.originalContents)
  };
}

function assertOriginalMigrationJournal(
  actual: Array<{ hash: string; createdAt: number }>,
  expected: Array<{ hash: string; createdAt: number }>
): void {
  if (JSON.stringify(actual) !== JSON.stringify(expected)) {
    throw new Error("Restored database migration journal does not match the encrypted manifest.");
  }
}

function assertPostgresCompatibility(targetVersion: string, sourceVersion: string): void {
  const targetMajor = Number.parseInt(targetVersion.split(".")[0] ?? "", 10);
  const sourceMajor = Number.parseInt(sourceVersion.split(".")[0] ?? "", 10);
  if (
    !Number.isInteger(targetMajor) ||
    !Number.isInteger(sourceMajor) ||
    targetMajor !== sourceMajor
  ) {
    throw new Error(
      `PostgreSQL major version mismatch: bundle ${sourceVersion}, clean installation ${targetVersion}.`
    );
  }
}

function resolvePort(env: Record<string, string>): number {
  const port = Number(env.DAOFLOW_PORT || "3000");
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error("The clean installation DAOFLOW_PORT is invalid.");
  }
  return port;
}
