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

describe("volumes command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-volumes-cli-"));
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

  test("volumes register in JSON mode still requires --yes", async () => {
    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "volumes",
        "register",
        "--name",
        "postgres-data",
        "--server-id",
        "srv_123",
        "--mount-path",
        "/var/lib/postgresql/data",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Register volume postgres-data on server srv_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("volumes register dry-run emits the standard success envelope", async () => {
    const program = createProgram();

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "volumes",
        "register",
        "--name",
        "postgres-data",
        "--server-id",
        "srv_123",
        "--mount-path",
        "/var/lib/postgresql/data",
        "--service-id",
        "svc_456",
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
        name: "postgres-data",
        serverId: "srv_123",
        mountPath: "/var/lib/postgresql/data",
        serviceId: "svc_456",
        driver: "local",
        status: "active"
      }
    });
  });

  test("volumes list returns inventory metadata in JSON mode", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/persistentVolumes");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                summary: {
                  totalVolumes: 1,
                  protectedVolumes: 1,
                  attentionVolumes: 0,
                  attachedBytes: 4096
                },
                volumes: [
                  {
                    id: "vol_123",
                    serverId: "srv_123",
                    environmentId: "env_123",
                    environmentName: "production",
                    projectId: "proj_123",
                    projectName: "DaoFlow",
                    serviceId: "svc_123",
                    serviceName: "postgres",
                    targetServerName: "foundation-vps-1",
                    volumeName: "postgres-data",
                    mountPath: "/var/lib/postgresql/data",
                    driver: "local",
                    sizeBytes: 4096,
                    status: "active",
                    backupPolicyId: "bpol_123",
                    storageProvider: "local",
                    lastBackupAt: null,
                    lastRestoreTestAt: null,
                    backupCoverage: "protected",
                    restoreReadiness: "untested",
                    statusTone: "running",
                    createdAt: "2026-03-20T00:00:00.000Z",
                    updatedAt: "2026-03-20T00:00:00.000Z"
                  }
                ]
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
      await runCli(["node", "daoflow", "volumes", "list", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        summary: {
          totalVolumes: 1,
          protectedVolumes: 1,
          attentionVolumes: 0,
          attachedBytes: 4096
        },
        volumes: [
          {
            id: "vol_123",
            serverId: "srv_123",
            environmentId: "env_123",
            environmentName: "production",
            projectId: "proj_123",
            projectName: "DaoFlow",
            serviceId: "svc_123",
            serviceName: "postgres",
            targetServerName: "foundation-vps-1",
            volumeName: "postgres-data",
            mountPath: "/var/lib/postgresql/data",
            driver: "local",
            sizeBytes: 4096,
            status: "active",
            backupPolicyId: "bpol_123",
            storageProvider: "local",
            lastBackupAt: null,
            lastRestoreTestAt: null,
            backupCoverage: "protected",
            restoreReadiness: "untested",
            statusTone: "running",
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z"
          }
        ]
      }
    });
  });
});
