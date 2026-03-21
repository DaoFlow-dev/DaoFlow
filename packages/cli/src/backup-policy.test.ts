import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCommandExecution } from "./login-test-helpers";
import { createProgram, runCli } from "./program";

const originalHome = process.env.HOME;
const originalUrl = process.env.DAOFLOW_URL;
const originalToken = process.env.DAOFLOW_TOKEN;
const originalFetch = globalThis.fetch;

describe("backup policy command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-backup-policy-cli-"));
    process.env.HOME = homeDir;
    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
  });

  afterEach(() => {
    if (originalHome) {
      process.env.HOME = originalHome;
    } else {
      delete process.env.HOME;
    }

    if (originalUrl) {
      process.env.DAOFLOW_URL = originalUrl;
    } else {
      delete process.env.DAOFLOW_URL;
    }

    if (originalToken) {
      process.env.DAOFLOW_TOKEN = originalToken;
    } else {
      delete process.env.DAOFLOW_TOKEN;
    }

    globalThis.fetch = originalFetch;
    rmSync(homeDir, { recursive: true, force: true });
  });

  test("backup policy create in JSON mode still requires --yes", async () => {
    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "policy",
        "create",
        "--name",
        "nightly-db",
        "--volume-id",
        "vol_123",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Create backup policy nightly-db. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("backup policy create dry-run emits the standard success envelope", async () => {
    const program = createProgram();

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "backup",
        "policy",
        "create",
        "--name",
        "nightly-db",
        "--volume-id",
        "vol_123",
        "--destination-id",
        "dest_456",
        "--schedule",
        "0 2 * * *",
        "--dry-run",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(3);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        dryRun: true,
        name: "nightly-db",
        volumeId: "vol_123",
        destinationId: "dest_456",
        backupType: "volume",
        turnOff: false,
        schedule: "0 2 * * *",
        retentionDays: 30,
        status: "active"
      }
    });
  });

  test("backup policy create returns the policy envelope in JSON mode", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/createBackupPolicy");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                id: "bpol_123",
                name: "nightly-db",
                volumeId: "vol_123",
                volumeName: "postgres-data",
                destinationId: "dest_456",
                destinationName: "primary-backups",
                backupType: "volume",
                databaseEngine: null,
                turnOff: false,
                schedule: "0 2 * * *",
                retentionDays: 30,
                retentionDaily: 7,
                retentionWeekly: 4,
                retentionMonthly: 12,
                maxBackups: 100,
                status: "active",
                createdAt: "2026-03-20T00:00:00.000Z",
                updatedAt: "2026-03-20T00:00:00.000Z"
              }
            }
          }),
          {
            headers: { "content-type": "application/json" }
          }
        )
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "policy",
        "create",
        "--name",
        "nightly-db",
        "--volume-id",
        "vol_123",
        "--destination-id",
        "dest_456",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        policy: {
          id: "bpol_123",
          name: "nightly-db",
          volumeId: "vol_123",
          volumeName: "postgres-data",
          destinationId: "dest_456",
          destinationName: "primary-backups",
          backupType: "volume",
          databaseEngine: null,
          turnOff: false,
          schedule: "0 2 * * *",
          retentionDays: 30,
          retentionDaily: 7,
          retentionWeekly: 4,
          retentionMonthly: 12,
          maxBackups: 100,
          status: "active",
          createdAt: "2026-03-20T00:00:00.000Z",
          updatedAt: "2026-03-20T00:00:00.000Z"
        }
      }
    });
  });
});
