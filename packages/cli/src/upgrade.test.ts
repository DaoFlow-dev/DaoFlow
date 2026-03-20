import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upgradeCommand, upgradeRuntime } from "./commands/upgrade";
import { captureCommandExecution } from "./login-test-helpers";

const originalUpgradeRuntime = {
  checkDocker: upgradeRuntime.checkDocker,
  exec: upgradeRuntime.exec,
  fetch: upgradeRuntime.fetch,
  fetchComposeYml: upgradeRuntime.fetchComposeYml,
  prompt: upgradeRuntime.prompt,
  sleep: upgradeRuntime.sleep
};

describe("upgrade command", () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), "daoflow-cli-upgrade-"));
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
    upgradeRuntime.fetch = (url: string) => {
      expect(url).toBe("http://127.0.0.1:8080/trpc/health");
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    upgradeRuntime.fetchComposeYml = () =>
      Promise.resolve("services:\n  daoflow:\n    image: ghcr.io/daoflow-dev/daoflow:latest\n");
    upgradeRuntime.prompt = () => Promise.resolve("y");
    upgradeRuntime.sleep = () => Promise.resolve();
  });

  afterEach(() => {
    upgradeRuntime.checkDocker = originalUpgradeRuntime.checkDocker;
    upgradeRuntime.exec = originalUpgradeRuntime.exec;
    upgradeRuntime.fetch = originalUpgradeRuntime.fetch;
    upgradeRuntime.fetchComposeYml = originalUpgradeRuntime.fetchComposeYml;
    upgradeRuntime.prompt = originalUpgradeRuntime.prompt;
    upgradeRuntime.sleep = originalUpgradeRuntime.sleep;
    rmSync(installDir, { recursive: true, force: true });
  });

  test("uses the configured port for upgrade health checks", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(upgradeCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "upgrade",
        "--dir",
        installDir,
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      previousVersion: "0.2.0",
      newVersion: "latest",
      directory: installDir,
      healthy: true
    });
    expect(readFileSync(join(installDir, ".env"), "utf8")).toContain("DAOFLOW_VERSION=latest");
  });

  test("keeps the existing compose file when compose retrieval fails", async () => {
    upgradeRuntime.fetchComposeYml = () => Promise.reject(new Error("network down"));

    const program = new Command().name("daoflow");
    program.addCommand(upgradeCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "upgrade",
        "--dir",
        installDir,
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: true,
      directory: installDir,
      healthy: true
    });
    expect(readFileSync(join(installDir, "docker-compose.yml"), "utf8")).toContain("image: old");
  });
});
