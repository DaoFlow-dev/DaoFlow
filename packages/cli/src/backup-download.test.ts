import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCommandExecution } from "./login-test-helpers";
import { runCli } from "./program";

const originalHome = process.env.HOME;
const originalUrl = process.env.DAOFLOW_URL;
const originalToken = process.env.DAOFLOW_TOKEN;
const originalFetch = globalThis.fetch;

describe("backup download command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-backup-download-cli-"));
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

  test("backup download queries backupRunDetails instead of scanning the overview list", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/backupRunDetails");
      expect(url).not.toContain("/trpc/backupOverview");
      expect(url).toContain("brun_archived_20260201");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                id: "brun_archived_20260201",
                policyId: "bpol_123",
                policyName: "nightly-db",
                projectName: "foundation",
                environmentName: "production",
                serviceName: "postgres",
                targetType: "database",
                destinationName: "primary-backups",
                destinationProvider: "s3",
                destinationServerName: "edge-1",
                mountPath: "/var/lib/postgresql/data",
                backupType: "database",
                databaseEngine: "postgres",
                scheduleLabel: "0 2 * * *",
                retentionCount: 30,
                status: "succeeded",
                statusTone: "healthy",
                triggerKind: "scheduled",
                executionEngine: "temporal",
                temporalWorkflowId: "wf_backup_123",
                requestedBy: "scheduler@daoflow.local",
                artifactPath: "s3://backups/foundation/postgres-2026-02-01.dump.zst",
                bytesWritten: 5242880,
                checksum: "abc123",
                verifiedAt: "2026-02-01T02:15:00.000Z",
                startedAt: "2026-02-01T02:00:00.000Z",
                finishedAt: "2026-02-01T02:05:00.000Z",
                error: null,
                restoreCount: 1,
                logsState: "available",
                logEntries: []
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
        "download",
        "--backup-run-id",
        "brun_archived_20260201",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        id: "brun_archived_20260201",
        status: "succeeded",
        artifact: "s3://backups/foundation/postgres-2026-02-01.dump.zst",
        size: 5242880,
        message: "Use rclone to download from the artifact path"
      }
    });
  });
});
