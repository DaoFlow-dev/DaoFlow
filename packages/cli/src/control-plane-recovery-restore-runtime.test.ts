import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  createRecoveryDatabase,
  readRecoveryDatabaseEvidence,
  readRecoveryPostgresVersion,
  restoreRecoveryDump,
  runRecoveryMigrations,
  type RecoveryRestoreRuntime
} from "./control-plane-recovery-restore-runtime";

const temporaryDirectories: string[] = [];

afterEach(() => {
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

function fakeRuntime(responses: string[] = []): {
  runtime: RecoveryRestoreRuntime;
  calls: Array<{ command: string; args: readonly string[]; env?: NodeJS.ProcessEnv }>;
} {
  const calls: Array<{ command: string; args: readonly string[]; env?: NodeJS.ProcessEnv }> = [];
  return {
    calls,
    runtime: {
      execFile(command, args, options) {
        calls.push({ command, args: [...args], env: options.env });
        return responses.shift() ?? "";
      },
      fetch: async () => new Response(null, { status: 200 }),
      sleep: async () => undefined,
      now: () => new Date("2026-07-18T12:00:00.000Z")
    }
  };
}

describe("control-plane recovery restore runtime", () => {
  test("creates only a database name that does not already exist", () => {
    const { runtime, calls } = fakeRuntime(["", ""]);
    createRecoveryDatabase({
      runtime,
      containerId: "postgres-container",
      databaseName: "daoflow_restore_cprb_123"
    });

    expect(calls).toHaveLength(2);
    expect(calls[0]?.args.join(" ")).toContain("SELECT 1 FROM pg_database");
    expect(calls[1]?.args).toContain("createdb");
    expect(calls[1]?.args).toContain("daoflow_restore_cprb_123");
  });

  test("copies the dump by argument and removes the container copy", () => {
    const { runtime, calls } = fakeRuntime();
    restoreRecoveryDump({
      runtime,
      containerId: "postgres-container",
      databaseName: "daoflow_restore_cprb_123",
      dumpPath: "/secure/path with spaces/recovery.dump",
      bundleId: "cprb_123"
    });

    expect(calls[0]?.args).toEqual([
      "cp",
      "/secure/path with spaces/recovery.dump",
      "postgres-container:/tmp/daoflow-recovery-cprb_123.dump"
    ]);
    expect(calls[1]?.args).toContain("pg_restore");
    expect(calls[2]?.args).toContain("rm");
  });

  test("passes secret names through the environment without putting values in arguments", () => {
    const directory = mkdtempSync(join(tmpdir(), "daoflow-restore-runtime-"));
    temporaryDirectories.push(directory);
    const envPath = join(directory, ".env");
    writeFileSync(envPath, "POSTGRES_PASSWORD=local-password\n", { mode: 0o600 });
    const { runtime, calls } = fakeRuntime();

    runRecoveryMigrations({
      runtime,
      dir: directory,
      envPath,
      databaseUrl: "postgresql://daoflow:local-password@postgres:5432/restored",
      externalSecrets: {
        BETTER_AUTH_SECRET: "super-secret-auth-value",
        ENCRYPTION_KEY: "super-secret-encryption-value"
      }
    });

    const call = calls[0];
    expect(call?.args.join(" ")).not.toContain("super-secret");
    expect(call?.args).toContain("BETTER_AUTH_SECRET");
    expect(call?.env?.BETTER_AUTH_SECRET).toBe("super-secret-auth-value");
    expect(call?.env?.DATABASE_URL).toContain("restored");
  });

  test("normalizes vendor-suffixed PostgreSQL versions", () => {
    const { runtime } = fakeRuntime(["17.5 (Debian 17.5-1.pgdg120+1)"]);
    expect(readRecoveryPostgresVersion({ runtime, containerId: "postgres-container" })).toBe(
      "17.5"
    );
  });

  test("rejects restored ownership orphans", () => {
    const fingerprint = "a".repeat(64);
    const { runtime } = fakeRuntime([
      JSON.stringify({
        teams: 1,
        users: 1,
        userIdentities: 1,
        teamMembers: 1,
        projects: 1,
        servers: 1,
        auditEntries: 1,
        backupPolicies: 1,
        backupRuns: 1,
        orphanTeamMembers: 1,
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
      })
    ]);

    expect(() =>
      readRecoveryDatabaseEvidence({
        runtime,
        containerId: "postgres-container",
        databaseName: "restored",
        verificationEmail: "owner@example.test"
      })
    ).toThrow("ownership and identity");
  });
});
