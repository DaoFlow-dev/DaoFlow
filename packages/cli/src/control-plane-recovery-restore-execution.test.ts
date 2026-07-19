import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  controlPlaneRecoveryRestoreExecutionDependencies,
  executeControlPlaneRecoveryRestore
} from "./control-plane-recovery-restore-execution";
import type { RecoveryRestoreRuntime } from "./control-plane-recovery-restore-runtime";
import type {
  ControlPlaneRecoveryRestoreInspection,
  RecoveryDatabaseEvidence
} from "./control-plane-recovery-restore-types";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fixture(): {
  directory: string;
  inspection: ControlPlaneRecoveryRestoreInspection;
  runtime: RecoveryRestoreRuntime;
} {
  const directory = mkdtempSync(join(tmpdir(), "daoflow-recovery-execution-"));
  temporaryDirectories.push(directory);
  writeFileSync(
    join(directory, ".env"),
    "DAOFLOW_DATABASE_NAME=daoflow\nDAOFLOW_PORT=3000\nDAOFLOW_WORKFLOW_PROFILE=lean\nPOSTGRES_PASSWORD=local-password\nBETTER_AUTH_SECRET=clean-auth\nENCRYPTION_KEY=clean-encryption-key\nDAOFLOW_RECOVERY_ENCRYPTION_KEY=clean-recovery-key\nDAOFLOW_INITIAL_ADMIN_EMAIL=clean@example.test\nDAOFLOW_INITIAL_ADMIN_PASSWORD=clean-password\n",
    { mode: 0o600 }
  );

  const migrations = [{ hash: "migration-1", createdAt: 1 }];
  const inspection: ControlPlaneRecoveryRestoreInspection = {
    bundle: {
      path: "/secure/bundle.dfr",
      sidecarPath: "/secure/latest.json",
      sha256: "a".repeat(64),
      keyFingerprint: "b".repeat(64),
      formatVersion: 1
    },
    manifest: {
      formatVersion: 1,
      bundleId: "cprb_test",
      appVersion: "0.9.2",
      schemaVersion: "migration-1",
      createdAt: "2026-07-18T12:00:00.000Z",
      database: {
        engine: "postgres",
        version: "17",
        dumpFormat: "postgres-custom",
        sha256: "c".repeat(64)
      },
      migrations: { count: 1, latestHash: "migration-1", applied: migrations },
      compatibility: { minimumAppVersion: "0.9.2", maximumAppVersionExclusive: "1.0.0" },
      requiredExternalSecrets: [
        "BETTER_AUTH_SECRET",
        "ENCRYPTION_KEY",
        "DAOFLOW_RECOVERY_ENCRYPTION_KEY"
      ],
      recoveryKey: { fingerprint: "b".repeat(64), rotatedAt: null },
      sanitization: { clearedFields: ["sessions"] },
      objects: {
        bundlePath: "control-plane-recovery/v1/cprb_test/bundle.dfr",
        manifestPath: "control-plane-recovery/v1/cprb_test/manifest.json",
        latestManifestPath: "control-plane-recovery/v1/latest.json"
      }
    },
    sidecar: {
      formatVersion: 1,
      bundleId: "cprb_test",
      appVersion: "0.9.2",
      schemaVersion: "migration-1",
      createdAt: "2026-07-18T12:00:00.000Z",
      bundlePath: "control-plane-recovery/v1/cprb_test/bundle.dfr",
      bundleSha256: "a".repeat(64),
      keyFingerprint: "b".repeat(64),
      compatibility: { minimumAppVersion: "0.9.2", maximumAppVersionExclusive: "1.0.0" },
      requiredExternalSecrets: [
        "BETTER_AUTH_SECRET",
        "ENCRYPTION_KEY",
        "DAOFLOW_RECOVERY_ENCRYPTION_KEY"
      ]
    },
    workspace: directory,
    dumpPath: join(directory, "recovery.dump"),
    cleanup: async () => undefined,
    secrets: {
      BETTER_AUTH_SECRET: "source-auth-secret",
      ENCRYPTION_KEY: "source-encryption-key-that-is-long-enough",
      DAOFLOW_RECOVERY_ENCRYPTION_KEY: "source-recovery-key-that-is-long-enough",
      DAOFLOW_RECOVERY_VERIFY_EMAIL: "owner@example.test",
      DAOFLOW_RECOVERY_VERIFY_PASSWORD: "owner-password"
    },
    plan: {
      version: 1,
      bundle: {
        id: "cprb_test",
        sha256: "a".repeat(64),
        databaseSha256: "c".repeat(64),
        appVersion: "0.9.2",
        schemaVersion: "migration-1",
        createdAt: "2026-07-18T12:00:00.000Z",
        keyFingerprint: "b".repeat(64)
      },
      installation: { directory, version: "0.9.2" },
      databases: { oldDatabase: "daoflow", newDatabase: "daoflow_recovery_cprb_test" },
      preflight: {
        keyedFingerprintAlgorithm: "hmac-sha256",
        executionSecretFingerprints: {},
        installationEnvDigest: "e".repeat(64),
        composeDigest: "f".repeat(64),
        targetPostgresVersion: "17.2",
        targetDatabaseDoesNotExist: true
      },
      requiredExternalSecrets: [
        "BETTER_AUTH_SECRET",
        "DAOFLOW_RECOVERY_ENCRYPTION_KEY",
        "DAOFLOW_RECOVERY_VERIFY_EMAIL",
        "DAOFLOW_RECOVERY_VERIFY_PASSWORD",
        "ENCRYPTION_KEY"
      ],
      verification: { email: "owner@example.test" },
      checks: [],
      steps: [],
      planHash: "d".repeat(64)
    }
  };

  return {
    directory,
    inspection,
    runtime: {
      execFile: () => "",
      fetch: async () => new Response(null, { status: 200 }),
      sleep: async () => undefined,
      now: () => new Date("2026-07-18T12:00:00.000Z")
    }
  };
}

const fingerprint = "a".repeat(64);
const databaseEvidence = {
  teams: 1,
  users: 1,
  userIdentities: 1,
  teamMembers: 1,
  projects: 2,
  servers: 1,
  auditEntries: 3,
  backupPolicies: 1,
  backupRuns: 4,
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
  backupRunsById: [
    { id: "run_a", policyId: "policy_a" },
    { id: "run_b", policyId: "policy_a" },
    { id: "run_c", policyId: "policy_a" },
    { id: "run_d", policyId: "policy_a" }
  ],
  verificationPrincipal: {
    id: "user_a",
    email: "owner@example.test",
    role: "owner",
    activeTeamId: "team_a"
  }
} satisfies RecoveryDatabaseEvidence;

describe("control-plane recovery restore execution", () => {
  test("switches only after restore and migration checks pass", async () => {
    const { directory, inspection, runtime } = fixture();
    const calls: string[] = [];
    const result = await executeControlPlaneRecoveryRestore(inspection, runtime, {
      ...controlPlaneRecoveryRestoreExecutionDependencies,
      stopControlPlane: () => calls.push("stop"),
      requirePostgres: () => "postgres-container",
      readPostgresVersion: () => "17.2",
      createDatabase: () => calls.push("create"),
      restoreDump: () => calls.push("restore"),
      readMigrationJournal: () => inspection.manifest.migrations.applied,
      runMigrations: () => calls.push("migrate"),
      readDatabaseEvidence: () => databaseEvidence,
      startControlPlane: () => calls.push("start"),
      verifyControlPlane: async () => ({
        viewer: { email: "owner@example.test", role: "owner" },
        projectIds: ["project_a", "project_b"],
        serverIds: ["server_a"],
        auditEntries: 3,
        backupPolicyIds: ["policy_a"],
        backupRunIds: ["run_a", "run_b", "run_c", "run_d"]
      }),
      waitForHealth: async () => true
    });

    expect(calls).toEqual(["stop", "create", "restore", "migrate", "start"]);
    expect(result.status).toBe("restored");
    expect(result.previousDatabase).toBe("daoflow");
    expect(readFileSync(join(directory, ".env"), "utf8")).toContain(
      "DAOFLOW_DATABASE_NAME=daoflow_recovery_cprb_test"
    );
    expect(readFileSync(join(directory, ".env"), "utf8")).not.toContain("owner-password");
  });

  test("restores the original config when post-start verification fails", async () => {
    const { directory, inspection, runtime } = fixture();
    const starts: string[] = [];

    await expect(
      executeControlPlaneRecoveryRestore(inspection, runtime, {
        ...controlPlaneRecoveryRestoreExecutionDependencies,
        stopControlPlane: () => undefined,
        requirePostgres: () => "postgres-container",
        readPostgresVersion: () => "17.2",
        createDatabase: () => undefined,
        restoreDump: () => undefined,
        readMigrationJournal: () => inspection.manifest.migrations.applied,
        runMigrations: () => undefined,
        readDatabaseEvidence: () => databaseEvidence,
        startControlPlane: () => starts.push(readFileSync(join(directory, ".env"), "utf8")),
        verifyControlPlane: async () => {
          throw new Error("post-start verification failed");
        },
        waitForHealth: async () => true
      })
    ).rejects.toThrow("original configuration was restored");

    const activeEnv = readFileSync(join(directory, ".env"), "utf8");
    expect(activeEnv).toContain("DAOFLOW_DATABASE_NAME=daoflow");
    expect(activeEnv).toContain("BETTER_AUTH_SECRET=clean-auth");
    expect(starts).toHaveLength(2);
    expect(starts[0]).toContain("daoflow_recovery_cprb_test");
    expect(starts[1]).toContain("DAOFLOW_DATABASE_NAME=daoflow");
  });

  test("restarts the original control plane after a stop reports failure late", async () => {
    const { inspection, runtime } = fixture();
    const calls: string[] = [];
    let controlPlaneRunning = true;

    await expect(
      executeControlPlaneRecoveryRestore(inspection, runtime, {
        ...controlPlaneRecoveryRestoreExecutionDependencies,
        stopControlPlane: () => {
          calls.push("stop");
          controlPlaneRunning = false;
          throw new Error("stop returned an error after the control plane stopped");
        },
        inspectRollbackState: () => {
          calls.push("inspect");
          return { controlPlaneRunning, configMatchesOriginal: true };
        },
        startControlPlane: () => {
          calls.push("restart");
          controlPlaneRunning = true;
        },
        waitForHealth: async () => {
          calls.push("health");
          return true;
        }
      })
    ).rejects.toThrow("Switchover did not occur");

    expect(calls).toEqual(["stop", "inspect", "restart", "health"]);
    expect(controlPlaneRunning).toBe(true);
  });

  test("restores the original config after a switch writes before reporting failure", async () => {
    const { directory, inspection, runtime } = fixture();
    const originalContents = readFileSync(join(directory, ".env"), "utf8");
    const calls: string[] = [];
    let writes = 0;
    let controlPlaneRunning = true;

    await expect(
      executeControlPlaneRecoveryRestore(inspection, runtime, {
        ...controlPlaneRecoveryRestoreExecutionDependencies,
        stopControlPlane: () => {
          calls.push("stop");
          controlPlaneRunning = false;
        },
        requirePostgres: () => "postgres-container",
        readPostgresVersion: () => "17.2",
        createDatabase: () => undefined,
        restoreDump: () => undefined,
        readMigrationJournal: () => inspection.manifest.migrations.applied,
        runMigrations: () => undefined,
        readDatabaseEvidence: () => databaseEvidence,
        writeEnvironment: (envPath, contents) => {
          writes += 1;
          writeFileSync(envPath, contents, { mode: 0o600 });
          if (writes === 1) throw new Error("config switch reported failure after writing");
        },
        inspectRollbackState: () => {
          calls.push("inspect");
          return {
            controlPlaneRunning,
            configMatchesOriginal:
              readFileSync(join(directory, ".env"), "utf8") === originalContents
          };
        },
        startControlPlane: () => {
          calls.push("restart");
          controlPlaneRunning = true;
        },
        waitForHealth: async () => {
          calls.push("health");
          return true;
        }
      })
    ).rejects.toThrow("original configuration was restored");

    expect(writes).toBe(2);
    expect(calls).toEqual(["stop", "inspect", "restart", "health"]);
    expect(readFileSync(join(directory, ".env"), "utf8")).toBe(originalContents);
  });

  test("redacts rollback failures without losing the manual recovery instruction", async () => {
    const { directory, inspection, runtime } = fixture();
    const databasePassword = "db password/with?characters";
    const encodedDatabasePassword = encodeURIComponent(databasePassword);
    const externalSecret = inspection.secrets.BETTER_AUTH_SECRET;
    const sessionToken = "rollback-session-token";
    writeFileSync(
      join(directory, ".env"),
      readFileSync(join(directory, ".env"), "utf8").replace("local-password", databasePassword),
      { mode: 0o600 }
    );
    let starts = 0;
    let controlPlaneRunning = false;
    let message = "";

    try {
      await executeControlPlaneRecoveryRestore(inspection, runtime, {
        ...controlPlaneRecoveryRestoreExecutionDependencies,
        stopControlPlane: () => undefined,
        requirePostgres: () => "postgres-container",
        readPostgresVersion: () => "17.2",
        createDatabase: () => undefined,
        restoreDump: () => undefined,
        readMigrationJournal: () => inspection.manifest.migrations.applied,
        runMigrations: () => undefined,
        readDatabaseEvidence: () => databaseEvidence,
        startControlPlane: () => {
          starts += 1;
          if (starts === 1) {
            controlPlaneRunning = true;
            return;
          }
          throw new Error(
            `rollback start failed postgresql://daoflow:${encodedDatabasePassword}@postgres:5432/daoflow password=${databasePassword} external=${externalSecret} better-auth.session_token=${sessionToken} Authorization: Bearer ${sessionToken}`
          );
        },
        verifyControlPlane: async () => {
          throw new Error("post-start verification failed");
        },
        inspectRollbackState: () => ({
          controlPlaneRunning,
          configMatchesOriginal: false
        }),
        waitForHealth: async () => true
      });
    } catch (error) {
      message = error instanceof Error ? error.message : String(error);
    }

    expect(message).toContain("Automatic rollback also failed");
    expect(message).toContain("[redacted database URL]");
    expect(message).not.toContain(databasePassword);
    expect(message).not.toContain(encodedDatabasePassword);
    expect(message).not.toContain(externalSecret);
    expect(message).not.toContain(sessionToken);
  });
});
