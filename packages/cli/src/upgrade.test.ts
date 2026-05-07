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
  let execCommands: string[];
  let requestedComposeVersions: Array<string | undefined>;

  beforeEach(() => {
    execCommands = [];
    requestedComposeVersions = [];
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

    upgradeRuntime.exec = (command: string) => {
      execCommands.push(command);
      return "";
    };
    upgradeRuntime.fetch = (url: string) => {
      expect(url).toBe("http://127.0.0.1:8080/ready");
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    upgradeRuntime.fetchComposeYml = (version?: string) => {
      requestedComposeVersions.push(version);
      return Promise.resolve(
        "services:\n  daoflow:\n    image: ghcr.io/daoflow-dev/daoflow:latest\n"
      );
    };
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
    expect(execCommands).toEqual(["docker compose pull", "docker compose up -d --remove-orphans"]);
    expect(requestedComposeVersions).toEqual(["latest"]);
    expect(readFileSync(join(installDir, ".env"), "utf8")).toContain("DAOFLOW_VERSION=latest");
  });

  test("preserves the Cloudflare Tunnel sidecar during upgrade", async () => {
    writeFileSync(
      join(installDir, ".env"),
      [
        "DAOFLOW_VERSION=0.2.0",
        "DAOFLOW_PORT=8080",
        "BETTER_AUTH_URL=https://deploy.example.com",
        "DAOFLOW_DOMAIN=deploy.example.com",
        "CLOUDFLARE_TUNNEL_TOKEN=cf-token-123"
      ].join("\n")
    );

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
    const composeFile = readFileSync(join(installDir, "docker-compose.yml"), "utf8");
    expect(composeFile).toContain("cloudflared:");
    expect(composeFile).toContain("cloudflare/cloudflared:latest");
    expect(composeFile).toContain("TUNNEL_TOKEN: ${CLOUDFLARE_TUNNEL_TOKEN}");
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

  test("fails without changing the pinned version when the target image pull fails", async () => {
    upgradeRuntime.exec = (command: string) => {
      execCommands.push(command);
      if (command === "docker compose pull") {
        throw new Error("pull denied");
      }
      return "";
    };

    const program = new Command().name("daoflow");
    program.addCommand(upgradeCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "upgrade",
        "--dir",
        installDir,
        "--version",
        "0.5.4",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      code: "PULL_FAILED",
      error: "pull denied"
    });
    expect(execCommands).toEqual(["docker compose pull"]);
    expect(requestedComposeVersions).toEqual(["0.5.4"]);
    expect(readFileSync(join(installDir, ".env"), "utf8")).toContain("DAOFLOW_VERSION=0.2.0");
  });

  test("fails when upgraded services do not become ready", async () => {
    upgradeRuntime.fetch = () => Promise.resolve(new Response("not ready", { status: 503 }));

    const program = new Command().name("daoflow");
    program.addCommand(upgradeCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "upgrade",
        "--dir",
        installDir,
        "--version",
        "0.5.4",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      code: "READINESS_TIMEOUT",
      error: "DaoFlow did not become ready after upgrade.",
      previousVersion: "0.2.0",
      newVersion: "0.5.4",
      directory: installDir,
      healthy: false
    });
    expect(execCommands).toEqual(["docker compose pull", "docker compose up -d --remove-orphans"]);
    expect(readFileSync(join(installDir, ".env"), "utf8")).toContain("DAOFLOW_VERSION=0.5.4");
  });
});
