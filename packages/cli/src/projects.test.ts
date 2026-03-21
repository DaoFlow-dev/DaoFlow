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

describe("projects command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-projects-cli-"));
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

  test("projects create in JSON mode still requires --yes", async () => {
    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "projects", "create", "--name", "demo", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Create project demo. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("projects create dry-run emits the standard success envelope", async () => {
    const program = createProgram();

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "projects",
        "create",
        "--name",
        "demo",
        "--repo-url",
        "https://github.com/acme/demo",
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
        name: "demo",
        repoUrl: "https://github.com/acme/demo",
        composeFiles: [],
        composeProfiles: [],
        autoDeploy: false
      }
    });
  });

  test("projects list returns summary metadata in JSON mode", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/projects");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: [
                {
                  id: "proj_123",
                  slug: "demo",
                  teamId: "team_foundation",
                  name: "Demo",
                  description: "Primary app",
                  repoFullName: "acme/demo",
                  repoUrl: "https://github.com/acme/demo",
                  sourceType: "compose",
                  status: "active",
                  statusTone: "healthy",
                  defaultBranch: "main",
                  composePath: "compose.yaml",
                  autoDeploy: true,
                  autoDeployBranch: "main",
                  createdByUserId: "user_foundation_owner",
                  config: {},
                  composeFiles: ["compose.yaml"],
                  composeProfiles: ["web"],
                  environmentCount: 2,
                  serviceCount: 3,
                  sourceReadiness: { status: "ready" },
                  createdAt: "2026-03-20T00:00:00.000Z",
                  updatedAt: "2026-03-20T00:00:00.000Z"
                }
              ]
            }
          }),
          {
            headers: { "content-type": "application/json" }
          }
        )
      );
    }) as unknown as typeof fetch;

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "projects", "list", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        summary: {
          totalProjects: 1,
          totalEnvironments: 2,
          totalServices: 3
        },
        projects: [
          {
            id: "proj_123",
            name: "Demo",
            description: "Primary app",
            repoFullName: "acme/demo",
            repoUrl: "https://github.com/acme/demo",
            sourceType: "compose",
            status: "active",
            statusTone: "healthy",
            defaultBranch: "main",
            autoDeploy: true,
            composeFiles: ["compose.yaml"],
            composeProfiles: ["web"],
            environmentCount: 2,
            serviceCount: 3,
            createdAt: "2026-03-20T00:00:00.000Z",
            updatedAt: "2026-03-20T00:00:00.000Z"
          }
        ]
      }
    });
  });
});
