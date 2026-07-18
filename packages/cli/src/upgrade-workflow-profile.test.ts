import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { upgradeCommand, upgradeRuntime } from "./commands/upgrade";
import { TEMPORAL_WORKER_CONNECTED_DETAIL } from "./install-health";
import { captureCommandExecution } from "./login-test-helpers";
import { parseEnvFile } from "./templates";

const originalUpgradeRuntime = {
  checkDocker: upgradeRuntime.checkDocker,
  exec: upgradeRuntime.exec,
  fetch: upgradeRuntime.fetch,
  fetchComposeYml: upgradeRuntime.fetchComposeYml,
  prompt: upgradeRuntime.prompt,
  sleep: upgradeRuntime.sleep
};

describe("upgrade workflow profiles", () => {
  let installDir: string;
  let execCommands: string[];

  beforeEach(() => {
    execCommands = [];
    installDir = mkdtempSync(join(tmpdir(), "daoflow-cli-upgrade-profile-"));
    writeFileSync(
      join(installDir, "docker-compose.yml"),
      "services:\n  daoflow:\n    image: old\n"
    );
    upgradeRuntime.exec = (command: string) => {
      execCommands.push(command);
      return "";
    };
    upgradeRuntime.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "ready",
            checks: [{ name: "workers", detail: TEMPORAL_WORKER_CONNECTED_DETAIL }]
          }),
          { status: 200 }
        )
      );
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

  test("activates the inferred Temporal profile during upgrade before persisting it", async () => {
    writeFileSync(
      join(installDir, ".env"),
      [
        "DAOFLOW_VERSION=0.2.0",
        "DAOFLOW_PORT=8080",
        "BETTER_AUTH_URL=http://deploy.example.com:8080",
        "DAOFLOW_ENABLE_TEMPORAL=true",
        "TEMPORAL_POSTGRES_PASSWORD=legacy-temporal-password"
      ].join("\n")
    );
    const composeEnvironments: Array<Record<string, string | undefined>> = [];
    upgradeRuntime.exec = (command, options) => {
      execCommands.push(command);
      if (command.startsWith("docker compose")) {
        composeEnvironments.push(options?.env as Record<string, string | undefined>);
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
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(0);
    expect(execCommands).toEqual([
      "docker compose pull",
      "docker compose --profile temporal up -d temporal",
      "docker compose --profile temporal exec -T temporal temporal operator cluster health --address temporal:7233",
      "docker compose --profile temporal up -d --remove-orphans daoflow"
    ]);
    expect(composeEnvironments).toHaveLength(4);
    for (const environment of [
      composeEnvironments[0],
      composeEnvironments[1],
      composeEnvironments[3]
    ]) {
      expect(environment).toMatchObject({
        DAOFLOW_VERSION: "latest",
        DAOFLOW_WORKFLOW_PROFILE: "temporal",
        COMPOSE_PROFILES: "temporal",
        DAOFLOW_ENABLE_TEMPORAL: "true"
      });
    }
    expect(parseEnvFile(readFileSync(join(installDir, ".env"), "utf8"))).toMatchObject({
      DAOFLOW_VERSION: "latest",
      DAOFLOW_WORKFLOW_PROFILE: "temporal",
      COMPOSE_PROFILES: "temporal",
      DAOFLOW_ENABLE_TEMPORAL: "true"
    });
  });

  test("does not persist inferred profile values when a Temporal image pull fails", async () => {
    const legacyEnv = [
      "DAOFLOW_VERSION=0.2.0",
      "DAOFLOW_PORT=8080",
      "BETTER_AUTH_URL=http://deploy.example.com:8080",
      "DAOFLOW_ENABLE_TEMPORAL=true",
      "TEMPORAL_POSTGRES_PASSWORD=legacy-temporal-password"
    ].join("\n");
    writeFileSync(join(installDir, ".env"), legacyEnv);
    const existingCompose = readFileSync(join(installDir, "docker-compose.yml"), "utf8");
    const composeEnvironments: Array<Record<string, string | undefined>> = [];
    upgradeRuntime.exec = (command, options) => {
      execCommands.push(command);
      if (command === "docker compose pull") {
        composeEnvironments.push(options?.env as Record<string, string | undefined>);
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
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(composeEnvironments).toHaveLength(1);
    expect(composeEnvironments[0]).toMatchObject({
      DAOFLOW_WORKFLOW_PROFILE: "temporal",
      COMPOSE_PROFILES: "temporal",
      DAOFLOW_ENABLE_TEMPORAL: "true"
    });
    expect(readFileSync(join(installDir, ".env"), "utf8")).toBe(legacyEnv);
    expect(readFileSync(join(installDir, "docker-compose.yml"), "utf8")).toBe(existingCompose);
  });

  test("requires the Temporal worker to reconnect after upgrade", async () => {
    writeFileSync(
      join(installDir, ".env"),
      [
        "DAOFLOW_VERSION=0.2.0",
        "DAOFLOW_PORT=8080",
        "BETTER_AUTH_URL=http://deploy.example.com:8080",
        "DAOFLOW_WORKFLOW_PROFILE=temporal",
        "COMPOSE_PROFILES=temporal",
        "DAOFLOW_ENABLE_TEMPORAL=true",
        "TEMPORAL_POSTGRES_PASSWORD=legacy-temporal-password"
      ].join("\n")
    );
    upgradeRuntime.fetch = () =>
      Promise.resolve(
        new Response(
          JSON.stringify({
            status: "ready",
            checks: [{ name: "workers", detail: "Legacy execution worker started." }]
          }),
          { status: 200 }
        )
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

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: false,
      code: "READINESS_TIMEOUT",
      healthy: false
    });
  });

  test("does not restart DaoFlow before the Temporal cluster is healthy", async () => {
    writeFileSync(
      join(installDir, ".env"),
      [
        "DAOFLOW_VERSION=0.2.0",
        "DAOFLOW_PORT=8080",
        "BETTER_AUTH_URL=http://deploy.example.com:8080",
        "DAOFLOW_WORKFLOW_PROFILE=temporal",
        "COMPOSE_PROFILES=temporal",
        "DAOFLOW_ENABLE_TEMPORAL=true",
        "TEMPORAL_POSTGRES_PASSWORD=legacy-temporal-password"
      ].join("\n")
    );
    upgradeRuntime.exec = (command: string) => {
      execCommands.push(command);
      if (command.includes("temporal operator cluster health")) {
        throw new Error("Temporal is still starting");
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
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: false,
      code: "TEMPORAL_CLUSTER_HEALTH_TIMEOUT"
    });
    expect(execCommands).toContain("docker compose --profile temporal up -d temporal");
    expect(execCommands).not.toContain(
      "docker compose --profile temporal up -d --remove-orphans daoflow"
    );
  });
});
