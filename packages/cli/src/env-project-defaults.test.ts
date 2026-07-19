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

function getRequestUrl(input: RequestInfo | URL) {
  return typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;
}

function getRequestBody(init?: RequestInit) {
  return typeof init?.body === "string" ? init.body : "";
}

describe("env project defaults", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-env-project-defaults-"));
    process.env.HOME = homeDir;
    process.env.DAOFLOW_URL = "https://daoflow.test";
    process.env.DAOFLOW_TOKEN = "dfl_test_token";
  });

  afterEach(() => {
    if (originalHome) process.env.HOME = originalHome;
    else delete process.env.HOME;
    if (originalUrl) process.env.DAOFLOW_URL = originalUrl;
    else delete process.env.DAOFLOW_URL;
    if (originalToken) process.env.DAOFLOW_TOKEN = originalToken;
    else delete process.env.DAOFLOW_TOKEN;
    globalThis.fetch = originalFetch;
    rmSync(homeDir, { recursive: true, force: true });
  });

  test("env list selects project defaults", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      expect(decodeURIComponent(getRequestUrl(input))).toContain("projectId");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                summary: {
                  totalVariables: 1,
                  projectDefaults: 1,
                  secretVariables: 1,
                  runtimeVariables: 1,
                  buildVariables: 0,
                  serviceOverrides: 0,
                  previewOverrides: 0,
                  resolvedVariables: 1
                },
                variables: [
                  {
                    id: "projvar_1",
                    scope: "project",
                    origin: "project",
                    scopeLabel: "Project default",
                    projectId: "proj_123",
                    projectName: "Demo",
                    environmentId: null,
                    environmentName: null,
                    serviceId: null,
                    serviceName: null,
                    key: "API_TOKEN",
                    displayValue: "[secret]",
                    isSecret: true,
                    category: "runtime",
                    source: "inline",
                    secretRef: null,
                    branchPattern: null,
                    revision: 2,
                    originSummary: "Project default",
                    updatedByEmail: "owner@example.test",
                    updatedAt: "2026-07-19T00:00:00.000Z"
                  }
                ],
                resolvedVariables: [],
                previewEnvironment: null
              }
            }
          }),
          { headers: { "content-type": "application/json" } }
        )
      );
    }) as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "env", "list", "--project-id", "proj_123", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(JSON.parse(result.logs[0] ?? "")).toMatchObject({
      ok: true,
      data: { variables: [{ scope: "project", revision: 2, displayValue: "[secret]" }] }
    });
  });

  test("env set sends a project-scoped write", async () => {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      expect(getRequestUrl(input)).toContain("/trpc/upsertEnvironmentVariable");
      expect(getRequestBody(init)).toContain("projectId");
      expect(getRequestBody(init)).toContain("scope");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                key: "APP_URL",
                projectId: "proj_123",
                projectName: "Demo",
                environmentId: null,
                environmentName: null,
                serviceId: null,
                serviceName: null,
                category: "runtime",
                scope: "project",
                origin: "project",
                branchPattern: null,
                revision: 1,
                status: "created"
              }
            }
          }),
          { headers: { "content-type": "application/json" } }
        )
      );
    }) as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "env",
        "set",
        "--project-id",
        "proj_123",
        "--key",
        "APP_URL",
        "--value",
        "https://example.test",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(JSON.parse(result.logs[0] ?? "")).toMatchObject({
      ok: true,
      data: { key: "APP_URL", project: "proj_123" }
    });
  });

  test("env delete sends a project-scoped delete", async () => {
    globalThis.fetch = ((input: RequestInfo | URL, init?: RequestInit) => {
      expect(getRequestUrl(input)).toContain("/trpc/deleteEnvironmentVariable");
      expect(getRequestBody(init)).toContain("projectId");
      expect(getRequestBody(init)).toContain("scope");
      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                key: "APP_URL",
                projectId: "proj_123",
                projectName: "Demo",
                environmentId: null,
                environmentName: null,
                serviceId: null,
                serviceName: null,
                scope: "project",
                origin: "project",
                branchPattern: null,
                revision: 2,
                status: "deleted"
              }
            }
          }),
          { headers: { "content-type": "application/json" } }
        )
      );
    }) as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "env",
        "delete",
        "--project-id",
        "proj_123",
        "--key",
        "APP_URL",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(JSON.parse(result.logs[0] ?? "")).toMatchObject({
      ok: true,
      data: { deleted: "APP_URL", project: "proj_123" }
    });
  });
});
