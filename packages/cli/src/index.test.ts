import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCommandExecution } from "./login-test-helpers";
import { runCli } from "./program";

const originalHome = process.env.HOME;
const originalUrl = process.env.DAOFLOW_URL;
const originalToken = process.env.DAOFLOW_TOKEN;

describe("CLI entrypoint", () => {
  let homeDir: string;

  beforeEach(() => {
    homeDir = mkdtempSync(join(tmpdir(), "daoflow-cli-entrypoint-"));
    process.env.HOME = homeDir;
    delete process.env.DAOFLOW_TOKEN;
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

    rmSync(homeDir, { recursive: true, force: true });
  });

  test("emits structured JSON for fatal config errors", async () => {
    process.env.DAOFLOW_URL = "https://env.example.com";

    const result = await captureCommandExecution(async () => {
      await runCli(["node", "daoflow", "whoami", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error:
        "DAOFLOW_URL and DAOFLOW_TOKEN must both be set when using environment-based CLI auth.",
      code: "CLI_ERROR"
    });
  });
});
