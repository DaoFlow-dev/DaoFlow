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

function responseFor(data: unknown): Response {
  return new Response(JSON.stringify({ result: { data } }), {
    headers: { "content-type": "application/json" }
  });
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

describe("backup destination external-import flags", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-destination-import-cli-"));
    process.env.HOME = homeDir;
    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
  });

  afterEach(() => {
    process.env.HOME = originalHome;
    if (originalUrl) process.env.DAOFLOW_URL = originalUrl;
    else delete process.env.DAOFLOW_URL;
    if (originalToken) process.env.DAOFLOW_TOKEN = originalToken;
    else delete process.env.DAOFLOW_TOKEN;
    globalThis.fetch = originalFetch;
    rmSync(homeDir, { recursive: true, force: true });
  });

  test("requires an approved prefix when enabling external imports", async () => {
    globalThis.fetch = (() =>
      Promise.reject(
        new Error("invalid destination flags must not call the API")
      )) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "destination",
        "add",
        "--name",
        "archive",
        "--provider",
        "s3",
        "--allow-external-imports",
        "--dry-run",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0] ?? "")).toEqual({
      ok: false,
      error: "--allow-external-imports requires --external-import-prefix.",
      code: "INVALID_INPUT"
    });
  });

  test("destination import dry-run and JSON never expose credentials", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("dry-run must not call the API"))) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "destination",
        "add",
        "--name",
        "archive",
        "--provider",
        "s3",
        "--access-key",
        "ACCESS_SECRET",
        "--secret-key",
        "SECRET_SECRET",
        "--allow-external-imports",
        "--external-import-prefix",
        "database-imports/",
        "--max-external-import-bytes",
        "4096",
        "--dry-run",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(3);
    const output = result.logs[0] ?? "";
    expect(output).toContain('"externalImportEnabled":true');
    expect(output).toContain('"externalImportPrefix":"database-imports/"');
    expect(output).toContain('"maxExternalImportBytes":4096');
    expect(output).not.toContain("ACCESS_SECRET");
    expect(output).not.toContain("SECRET_SECRET");
  });

  test("destination import execution forwards the boundary settings", async () => {
    let body = "";
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      expect(requestUrl(input)).toContain("/trpc/createBackupDestination");
      body = typeof init?.body === "string" ? init.body : "";
      return Promise.resolve(
        responseFor({
          id: "dest_123",
          name: "archive",
          provider: "s3",
          accessKey: null,
          bucket: "backups",
          region: "us-east-1",
          endpoint: null,
          s3Provider: null,
          rcloneType: null,
          rcloneRemotePath: null,
          localPath: null,
          externalImportEnabled: true,
          externalImportPrefix: "database-imports/",
          maxExternalImportBytes: 4096,
          lastTestedAt: null,
          lastTestResult: null,
          createdAt: "2026-07-19T12:00:00.000Z",
          updatedAt: "2026-07-19T12:00:00.000Z"
        })
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "destination",
        "add",
        "--name",
        "archive",
        "--provider",
        "s3",
        "--access-key",
        "ACCESS_SECRET",
        "--secret-key",
        "SECRET_SECRET",
        "--allow-external-imports",
        "--external-import-prefix",
        "database-imports/",
        "--max-external-import-bytes",
        "4096",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(body).toContain("externalImportEnabled");
    expect(body).toContain("database-imports/");
    expect(body).toContain("4096");
    expect(result.logs.join("\n")).not.toContain("ACCESS_SECRET");
    expect(result.logs.join("\n")).not.toContain("SECRET_SECRET");
  });
});
