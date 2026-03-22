import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { captureCommandExecution } from "./login-test-helpers";
import { runCli } from "./program";
import { upgradeRuntime } from "./commands/upgrade";
import { CLI_VERSION } from "./version";

const originalHome = process.env.HOME;
const originalUrl = process.env.DAOFLOW_URL;
const originalToken = process.env.DAOFLOW_TOKEN;
const originalUpgradeRuntime = {
  exec: upgradeRuntime.exec,
  fetch: upgradeRuntime.fetch,
  fetchComposeYml: upgradeRuntime.fetchComposeYml,
  prompt: upgradeRuntime.prompt,
  sleep: upgradeRuntime.sleep
};

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

    upgradeRuntime.exec = originalUpgradeRuntime.exec;
    upgradeRuntime.fetch = originalUpgradeRuntime.fetch;
    upgradeRuntime.fetchComposeYml = originalUpgradeRuntime.fetchComposeYml;
    upgradeRuntime.prompt = originalUpgradeRuntime.prompt;
    upgradeRuntime.sleep = originalUpgradeRuntime.sleep;

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

  test("preserves top-level --version output without stealing upgrade --version", async () => {
    const installDir = mkdtempSync(join(tmpdir(), "daoflow-cli-upgrade-entrypoint-"));
    writeFileSync(
      join(installDir, ".env"),
      [
        "DAOFLOW_VERSION=0.2.0",
        "DAOFLOW_PORT=8080",
        "BETTER_AUTH_URL=http://deploy.example.com:8080"
      ].join("\n")
    );
    writeFileSync(
      join(installDir, "docker-compose.yml"),
      "services:\n  daoflow:\n    image: old\n"
    );

    upgradeRuntime.exec = () => "";
    upgradeRuntime.fetch = () =>
      Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    upgradeRuntime.fetchComposeYml = () =>
      Promise.resolve("services:\n  daoflow:\n    image: ghcr.io/daoflow-dev/daoflow:0.2.1\n");
    upgradeRuntime.prompt = () => Promise.resolve("y");
    upgradeRuntime.sleep = () => Promise.resolve();

    try {
      const versionResult = await captureCommandExecution(async () => {
        await runCli(["node", "daoflow", "--version"]);
      });
      expect(versionResult.exitCode).toBeNull();
      expect(versionResult.logs).toEqual([CLI_VERSION]);

      const upgradeResult = await captureCommandExecution(async () => {
        await runCli([
          "node",
          "daoflow",
          "upgrade",
          "--dir",
          installDir,
          "--version",
          "0.2.1",
          "--yes",
          "--json"
        ]);
      });

      expect(upgradeResult.exitCode).toBe(0);
      expect(JSON.parse(upgradeResult.logs[0])).toEqual({
        ok: true,
        previousVersion: "0.2.0",
        newVersion: "0.2.1",
        directory: installDir,
        healthy: true
      });
      expect(readFileSync(join(installDir, ".env"), "utf8")).toContain("DAOFLOW_VERSION=0.2.1");
    } finally {
      rmSync(installDir, { recursive: true, force: true });
    }
  });
});
