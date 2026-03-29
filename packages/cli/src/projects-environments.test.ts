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

describe("projects env command", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-project-environments-cli-"));
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

  test("projects env create in JSON mode still requires --yes", async () => {
    const result = await captureCommandExecution(async () => {
      await runCli([
        "node",
        "daoflow",
        "projects",
        "env",
        "create",
        "--project",
        "proj_123",
        "--name",
        "production",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Create environment production in project proj_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("projects env create dry-run emits the standard success envelope", async () => {
    const program = createProgram();

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "projects",
        "env",
        "create",
        "--project",
        "proj_123",
        "--name",
        "production",
        "--server",
        "srv_123",
        "--compose-file",
        "compose.yaml",
        "--compose-file",
        "compose.production.yaml",
        "--compose-profile",
        "web",
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
        projectId: "proj_123",
        name: "production",
        targetServerId: "srv_123",
        composeFiles: ["compose.yaml", "compose.production.yaml"],
        composeProfiles: ["web"]
      }
    });
  });

  test("projects env create returns environment ids and status in JSON mode", async () => {
    globalThis.fetch = ((input: RequestInfo | URL) => {
      const url =
        typeof input === "string" ? input : input instanceof URL ? input.toString() : input.url;

      expect(url).toContain("/trpc/createEnvironment");

      return Promise.resolve(
        new Response(
          JSON.stringify({
            result: {
              data: {
                id: "env_123",
                projectId: "proj_123",
                name: "production",
                slug: "production",
                status: "healthy",
                targetServerId: "srv_123",
                composeFiles: ["compose.yaml"],
                composeProfiles: ["web"],
                createdAt: "2026-03-29T00:00:00.000Z",
                updatedAt: "2026-03-29T00:00:00.000Z"
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
        "projects",
        "env",
        "create",
        "--project",
        "proj_123",
        "--name",
        "production",
        "--server",
        "srv_123",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        environment: {
          id: "env_123",
          projectId: "proj_123",
          name: "production",
          status: "healthy"
        }
      }
    });
  });
});
