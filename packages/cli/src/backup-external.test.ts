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

function scopeDeniedResponse(requiredScope: string): Response {
  return new Response(
    JSON.stringify({
      error: {
        message: `Missing required scope(s): ${requiredScope}`,
        code: -32003,
        data: {
          code: "FORBIDDEN",
          cause: {
            code: "SCOPE_DENIED",
            requiredScopes: [requiredScope],
            grantedScopes: ["backup:read"]
          }
        }
      }
    }),
    { status: 403, headers: { "content-type": "application/json" } }
  );
}

function requestUrl(input: RequestInfo | URL): string {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

describe("external backup CLI commands", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-external-backup-cli-"));
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

  test("lists external artifacts in the standard JSON envelope", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      expect(requestUrl(input)).toContain("/trpc/externalBackupArtifacts");
      return Promise.resolve(
        responseFor({
          artifacts: [
            {
              id: "xart_123",
              destinationId: "dest_123",
              destinationName: "archive",
              objectKey: "database-imports/app.dump",
              objectVersion: "version-1",
              objectEtag: null,
              sizeBytes: "4096",
              sha256: "a".repeat(64),
              status: "verified",
              verifiedAt: "2026-07-19T12:00:00.000Z"
            }
          ]
        })
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "backup", "external", "list", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(JSON.parse(result.logs[0] ?? "")).toEqual({
      ok: true,
      data: {
        artifacts: [
          expect.objectContaining({
            id: "xart_123",
            objectKey: "database-imports/app.dump",
            objectVersion: "version-1",
            status: "verified"
          })
        ]
      }
    });
  });

  test("lists only the approved destination object prefix", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      expect(requestUrl(input)).toContain("/trpc/externalBackupObjects");
      return Promise.resolve(
        responseFor({
          destination: { id: "dest_123", name: "archive", provider: "s3" },
          prefix: "database-imports/daily/",
          objects: [
            {
              key: "database-imports/daily/app.dump",
              name: "app.dump",
              size: 2048,
              lastModified: null,
              etag: "etag-1",
              versionId: null
            }
          ]
        })
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "destination",
        "files",
        "--id",
        "dest_123",
        "--prefix",
        "daily/",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(JSON.parse(result.logs[0] ?? "")).toMatchObject({
      ok: true,
      data: {
        prefix: "database-imports/daily/",
        objects: [{ key: "database-imports/daily/app.dump" }]
      }
    });
  });

  test("human artifact output shows origin, key, pinned identity, size, checksum, and status", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(
        responseFor({
          artifacts: [
            {
              id: "xart_123",
              destinationId: "dest_123",
              destinationName: "archive",
              objectKey: "database-imports/app.dump",
              objectVersion: null,
              objectEtag: "etag-1",
              sizeBytes: 4096,
              sha256: "a".repeat(64),
              status: "verified"
            }
          ]
        })
      )) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "backup", "external", "list"]);
    });

    const output = result.logs.join("\n");
    expect(output).toContain("External (archive)");
    expect(output).toContain("database-imports/app.dump");
    expect(output).toContain("etag-1");
    expect(output).toContain("4.0 KB");
    expect(output).toContain("a".repeat(64));
    expect(output).toContain("verified");
  });

  test("register dry-run is local, uses exit code 3, and emits JSON", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("dry-run must not call the API"))) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "external",
        "register",
        "--destination",
        "dest_123",
        "--object-key",
        "database-imports/app.dump",
        "--postgres-major",
        "17",
        "--dry-run",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.logs[0] ?? "")).toEqual({
      ok: true,
      data: {
        dryRun: true,
        destinationId: "dest_123",
        objectKey: "database-imports/app.dump",
        postgresMajor: 17
      }
    });
  });

  test("register requires confirmation before mutation", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("confirmation must happen first"))) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "external",
        "register",
        "--destination",
        "dest_123",
        "--object-key",
        "database-imports/app.dump",
        "--postgres-major",
        "17",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0] ?? "")).toEqual({
      ok: false,
      error: "To register external artifact database-imports/app.dump, add --yes",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("rejects traversal object keys before any API call", async () => {
    globalThis.fetch = (() =>
      Promise.reject(new Error("invalid input must not call the API"))) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "external",
        "register",
        "--destination",
        "dest_123",
        "--object-key",
        "../secrets.dump",
        "--postgres-major",
        "17",
        "--dry-run",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0] ?? "")).toEqual({
      ok: false,
      error: "Object key cannot include path traversal patterns.",
      code: "INVALID_INPUT"
    });
  });

  test("preserves the required scope in permission errors", async () => {
    globalThis.fetch = (() =>
      Promise.resolve(scopeDeniedResponse("backup:read"))) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "backup", "external", "list", "--json"]);
    });

    expect(result.exitCode).toBe(2);
    expect(JSON.parse(result.logs[0] ?? "")).toEqual({
      ok: false,
      error: "Missing required scope(s): backup:read",
      code: "SCOPE_DENIED",
      requiredScopes: ["backup:read"],
      grantedScopes: ["backup:read"]
    });
  });

  test("restore dry-run calls the plan route and exits 3", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      expect(requestUrl(input)).toContain("/trpc/externalArtifactRestorePlan");
      return Promise.resolve(
        responseFor({
          isReady: true,
          preflightChecks: [{ status: "ok", detail: "Artifact is verified." }],
          steps: ["Request approval after review."]
        })
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "external",
        "restore",
        "--artifact-id",
        "xart_123",
        "--target-volume",
        "vol_123",
        "--dry-run",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(3);
    expect(JSON.parse(result.logs[0] ?? "")).toEqual({
      ok: true,
      data: {
        dryRun: true,
        plan: expect.objectContaining({ isReady: true })
      }
    });
  });

  test("verify execution queues the isolated test restore", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      expect(requestUrl(input)).toContain("/trpc/triggerExternalArtifactTestRestore");
      return Promise.resolve(
        responseFor({ id: "restore_123", artifactId: "xart_123", status: "queued" })
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "external",
        "verify",
        "--artifact-id",
        "xart_123",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(JSON.parse(result.logs[0] ?? "")).toEqual({
      ok: true,
      data: { id: "restore_123", artifactId: "xart_123", status: "queued" }
    });
  });

  test("production restore requests approval and never calls a direct restore route", async () => {
    const urls: string[] = [];
    let body = "";
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input);
      urls.push(url);
      body = typeof init?.body === "string" ? init.body : "";
      expect(url).toContain("/trpc/requestExternalArtifactRestoreApproval");
      return Promise.resolve(
        responseFor({
          id: "apr_123",
          actionType: "external-artifact-restore",
          status: "pending",
          reason: "Restore after an incident"
        })
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "backup",
        "external",
        "restore",
        "--artifact-id",
        "xart_123",
        "--target-volume",
        "vol_123",
        "--yes",
        "--reason",
        "Restore after an incident",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(urls).toHaveLength(1);
    expect(
      urls.some(
        (url) => url.includes("restore") && !url.includes("requestExternalArtifactRestoreApproval")
      )
    ).toBe(false);
    expect(body).toContain("xart_123");
    expect(body).toContain("vol_123");
    const output = JSON.parse(result.logs[0] ?? "");
    expect(output).toMatchObject({
      ok: true,
      data: {
        approvalRequested: true,
        request: { id: "apr_123", actionType: "external-artifact-restore" }
      }
    });
    expect(output.data.nextAction).toContain("different authorized actor");
  });
});
