import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { controlPlaneRecoveryRestoreCommandRuntime } from "./commands/control-plane-recovery-restore";
import type { ControlPlaneRecoveryRestoreInspection } from "./control-plane-recovery-restore-types";
import { captureCommandExecution } from "./login-test-helpers";
import { runCli } from "./program";

const originalInspect = controlPlaneRecoveryRestoreCommandRuntime.inspect;
const originalExecute = controlPlaneRecoveryRestoreCommandRuntime.execute;

const plan = {
  version: 1 as const,
  bundle: {
    id: "cprb_test",
    sha256: "a".repeat(64),
    databaseSha256: "b".repeat(64),
    appVersion: "0.9.2",
    schemaVersion: "migration-1",
    createdAt: "2026-07-18T12:00:00.000Z",
    keyFingerprint: "c".repeat(64)
  },
  installation: { directory: "/opt/daoflow", version: "0.9.2" },
  databases: { oldDatabase: "daoflow", newDatabase: "daoflow_recovery_cprb_test" },
  preflight: {
    keyedFingerprintAlgorithm: "hmac-sha256" as const,
    executionSecretFingerprints: {},
    installationEnvDigest: "e".repeat(64),
    composeDigest: "f".repeat(64),
    targetPostgresVersion: "17.2",
    targetDatabaseDoesNotExist: true as const
  },
  requiredExternalSecrets: ["BETTER_AUTH_SECRET"],
  verification: { email: "owner@example.test" },
  checks: [],
  steps: [],
  planHash: "d".repeat(64)
};

function fakeInspection(): ControlPlaneRecoveryRestoreInspection {
  return {
    plan,
    manifest: { requiredExternalSecrets: [] },
    secrets: { EXTERNAL_SECRET: "source-external-secret" },
    workspace: "/tmp/daoflow-recovery-workspace",
    cleanup: async () => undefined
  } as unknown as ControlPlaneRecoveryRestoreInspection;
}

function args(...extra: string[]): string[] {
  return [
    "node",
    "daoflow",
    "backup",
    "recovery",
    "restore",
    "--dir",
    "/opt/daoflow",
    "--bundle",
    "/secure/bundle.dfr",
    "--manifest",
    "/secure/latest.json",
    "--external-secrets",
    "/secure/recovery.env",
    ...extra,
    "--json"
  ];
}

describe("control-plane recovery restore command", () => {
  beforeEach(() => {
    controlPlaneRecoveryRestoreCommandRuntime.inspect = async () => fakeInspection();
    controlPlaneRecoveryRestoreCommandRuntime.execute = async () => ({
      status: "restored",
      bundleId: "cprb_test",
      previousDatabase: "daoflow",
      restoredDatabase: "daoflow_recovery_cprb_test",
      previousConfigPath: "/opt/daoflow/.env.pre-recovery",
      databaseEvidence: {
        teams: 1,
        users: 1,
        userIdentities: 1,
        teamMembers: 1,
        projects: 1,
        servers: 1,
        auditEntries: 1,
        backupPolicies: 1,
        backupRuns: 1,
        orphanTeamMembers: 0,
        orphanProjects: 0,
        orphanServers: 0,
        fingerprints: {
          teams: "a".repeat(64),
          users: "a".repeat(64),
          userIdentities: "a".repeat(64),
          teamMembers: "a".repeat(64),
          projects: "a".repeat(64),
          auditEntries: "a".repeat(64),
          backupPolicies: "a".repeat(64),
          backupRuns: "a".repeat(64)
        },
        projectsById: [{ id: "project_a", teamId: "team_a" }],
        serversById: [{ id: "server_a", teamId: "team_a" }],
        backupPoliciesById: [{ id: "policy_a", teamId: "team_a" }],
        backupRunsById: [{ id: "run_a", policyId: "policy_a" }],
        verificationPrincipal: {
          id: "user_a",
          email: "owner@example.test",
          role: "owner",
          activeTeamId: "team_a"
        }
      },
      controlPlaneEvidence: {
        viewer: { email: "owner@example.test", role: "owner" },
        projectIds: ["project_a"],
        serverIds: ["server_a"],
        auditEntries: 1,
        backupPolicyIds: ["policy_a"],
        backupRunIds: ["run_a"]
      },
      rollback: { databaseRetained: true, configRetained: true }
    });
  });

  afterEach(() => {
    controlPlaneRecoveryRestoreCommandRuntime.inspect = originalInspect;
    controlPlaneRecoveryRestoreCommandRuntime.execute = originalExecute;
  });

  test("dry-run returns a secret-free plan and exit code 3", async () => {
    const result = await captureCommandExecution(async () => {
      await runCli(args("--dry-run"));
    });

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.logs[0])).toEqual({ ok: true, data: { dryRun: true, plan } });
    expect(result.logs.join("\n")).not.toContain("owner-password");
  });

  test("execution requires the exact plan hash and --yes", async () => {
    const missing = await captureCommandExecution(async () => {
      await runCli(args("--yes"));
    });
    const mismatch = await captureCommandExecution(async () => {
      await runCli(args("--yes", "--confirm", "wrong"));
    });

    expect(missing.exitCode).toBe(1);
    expect(JSON.parse(missing.logs[0])).toMatchObject({
      ok: false,
      code: "CONFIRMATION_REQUIRED"
    });
    expect(JSON.parse(missing.logs[0])).not.toHaveProperty("expectedPlanHash");
    expect(JSON.parse(mismatch.logs[0])).toMatchObject({
      ok: false,
      code: "PLAN_HASH_MISMATCH",
      error: "The supplied recovery plan hash does not match the current plan."
    });
    expect(JSON.parse(mismatch.logs[0])).not.toHaveProperty("expectedPlanHash");
    expect(missing.logs.join("\n")).not.toContain(plan.planHash);
    expect(mismatch.logs.join("\n")).not.toContain(plan.planHash);
  });

  test("matching confirmation returns retained rollback evidence", async () => {
    const result = await captureCommandExecution(async () => {
      await runCli(args("--yes", "--confirm", plan.planHash));
    });

    expect(result.exitCode).toBeNull();
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: true,
      data: {
        status: "restored",
        previousDatabase: "daoflow",
        restoredDatabase: "daoflow_recovery_cprb_test",
        rollback: { databaseRetained: true, configRetained: true }
      }
    });
  });

  test("redacts command errors from the restore executor", async () => {
    const databasePassword = "db-password/with?characters";
    const encodedDatabasePassword = encodeURIComponent(databasePassword);
    const sessionToken = "command-session-token";
    controlPlaneRecoveryRestoreCommandRuntime.execute = async () => {
      throw new Error(
        `restore failed postgresql://daoflow:${encodedDatabasePassword}@postgres:5432/daoflow password=${databasePassword} external=source-external-secret better-auth.session_token=${sessionToken} Authorization: Bearer ${sessionToken}`
      );
    };

    const result = await captureCommandExecution(async () => {
      await runCli(args("--yes", "--confirm", plan.planHash));
    });
    const output = result.logs.join("\n");

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: false,
      code: "RECOVERY_RESTORE_FAILED"
    });
    expect(output).not.toContain(databasePassword);
    expect(output).not.toContain(encodedDatabasePassword);
    expect(output).not.toContain("source-external-secret");
    expect(output).not.toContain(sessionToken);
  });

  test("keeps a completed restore successful when workspace cleanup fails", async () => {
    controlPlaneRecoveryRestoreCommandRuntime.inspect = async () => ({
      ...fakeInspection(),
      cleanup: async () => {
        throw new Error("cleanup failed with source-external-secret");
      }
    });

    const result = await captureCommandExecution(async () => {
      await runCli(args("--yes", "--confirm", plan.planHash));
    });
    const payload = JSON.parse(result.logs[0]);

    expect(result.exitCode).toBeNull();
    expect(payload).toMatchObject({
      ok: true,
      data: {
        status: "restored",
        warnings: [
          "Recovery workspace cleanup failed. Remove the temporary recovery workspace manually: /tmp/daoflow-recovery-workspace."
        ]
      }
    });
    expect(result.logs.join("\n")).not.toContain("source-external-secret");
  });

  test("reports a dry-run cleanup warning without hiding the reviewed plan", async () => {
    controlPlaneRecoveryRestoreCommandRuntime.inspect = async () => ({
      ...fakeInspection(),
      cleanup: async () => {
        throw new Error("cleanup failed with source-external-secret");
      }
    });

    const result = await captureCommandExecution(async () => {
      await runCli(args("--dry-run"));
    });
    const payload = JSON.parse(result.logs[0]);

    expect(result.exitCode).toBe(3);
    expect(payload).toMatchObject({
      ok: true,
      data: {
        dryRun: true,
        plan,
        warnings: [
          "Recovery workspace cleanup failed. Remove the temporary recovery workspace manually: /tmp/daoflow-recovery-workspace."
        ]
      }
    });
    expect(result.logs.join("\n")).not.toContain("source-external-secret");
  });
});
