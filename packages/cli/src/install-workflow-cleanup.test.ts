import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand, installRuntime } from "./commands/install";
import { captureCommandExecution } from "./login-test-helpers";
import { generateEnvFile, parseEnvFile } from "./templates";

const originalInstallRuntime = {
  checkDocker: installRuntime.checkDocker,
  exec: installRuntime.exec,
  fetch: installRuntime.fetch,
  fetchComposeYml: installRuntime.fetchComposeYml,
  prompt: installRuntime.prompt,
  promptSelect: installRuntime.promptSelect,
  sleep: installRuntime.sleep
};

describe("Temporal-to-lean install cleanup", () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), "daoflow-cli-install-cleanup-"));
    installRuntime.checkDocker = () => ({
      available: true,
      compose: true,
      version: "Docker version 26.0.0"
    });
    installRuntime.fetch = () => {
      throw new Error("DaoFlow must not start when Temporal cleanup fails");
    };
    installRuntime.fetchComposeYml = () =>
      Promise.resolve("services:\n  daoflow:\n    image: ghcr.io/daoflow-dev/daoflow:latest\n");
    installRuntime.prompt = () => {
      throw new Error("prompt should not be used in non-interactive tests");
    };
    installRuntime.promptSelect = () => {
      throw new Error("promptSelect should not be used in non-interactive tests");
    };
    installRuntime.sleep = () => Promise.resolve();
  });

  afterEach(() => {
    installRuntime.checkDocker = originalInstallRuntime.checkDocker;
    installRuntime.exec = originalInstallRuntime.exec;
    installRuntime.fetch = originalInstallRuntime.fetch;
    installRuntime.fetchComposeYml = originalInstallRuntime.fetchComposeYml;
    installRuntime.prompt = originalInstallRuntime.prompt;
    installRuntime.promptSelect = originalInstallRuntime.promptSelect;
    installRuntime.sleep = originalInstallRuntime.sleep;
    rmSync(installDir, { recursive: true, force: true });
  });

  test("preserves the Temporal profile when container cleanup fails", async () => {
    const existingEnv = generateEnvFile({
      version: "0.2.0",
      domain: "deploy.example.com",
      port: 3000,
      initialAdminEmail: "existing-owner@example.com",
      initialAdminPassword: "existing-owner-secret",
      workflowProfile: "temporal"
    });
    writeFileSync(join(installDir, ".env"), existingEnv);
    const existingCompose = "services:\n  daoflow:\n    image: ghcr.io/daoflow-dev/daoflow:old\n";
    writeFileSync(join(installDir, "docker-compose.yml"), existingCompose);
    const commands: string[] = [];
    installRuntime.exec = (command: string) => {
      commands.push(command);
      if (command.includes(" rm --stop --force temporal temporal-postgresql temporal-ui")) {
        throw new Error("cleanup failed");
      }
      return "";
    };

    const program = new Command().name("daoflow");
    program.addCommand(installCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "install",
        "--dir",
        installDir,
        "--workflow-profile",
        "lean",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: false,
      code: "TEMPORAL_PROFILE_CLEANUP_FAILED",
      workflowProfilePlan: {
        change: "temporal-to-lean",
        services: {
          removed: ["temporal-ui", "temporal", "temporal-postgresql"]
        }
      }
    });
    expect(JSON.parse(result.errors[0])).toMatchObject({
      ok: true,
      event: "workflow-profile-plan"
    });
    expect(readFileSync(join(installDir, ".env"), "utf8")).toBe(existingEnv);
    expect(parseEnvFile(readFileSync(join(installDir, ".env"), "utf8"))).toMatchObject({
      DAOFLOW_WORKFLOW_PROFILE: "temporal",
      COMPOSE_PROFILES: "temporal",
      DAOFLOW_ENABLE_TEMPORAL: "true"
    });
    expect(readFileSync(join(installDir, "docker-compose.yml"), "utf8")).toBe(existingCompose);
    expect(commands).toEqual([
      "docker info",
      "docker compose --profile temporal --profile temporal-ui rm --stop --force temporal temporal-postgresql temporal-ui"
    ]);
    expect(commands.some((command) => command.includes("down -v"))).toBe(false);
  });

  test("does not change files or remove Temporal when compose retrieval fails", async () => {
    const existingEnv = generateEnvFile({
      version: "0.2.0",
      domain: "deploy.example.com",
      port: 3000,
      initialAdminEmail: "existing-owner@example.com",
      initialAdminPassword: "existing-owner-secret",
      workflowProfile: "temporal"
    });
    const existingCompose = "services:\n  daoflow:\n    image: ghcr.io/daoflow-dev/daoflow:old\n";
    writeFileSync(join(installDir, ".env"), existingEnv);
    writeFileSync(join(installDir, "docker-compose.yml"), existingCompose);
    installRuntime.fetchComposeYml = () => Promise.reject(new Error("network down"));
    const commands: string[] = [];
    installRuntime.exec = (command: string) => {
      commands.push(command);
      return "";
    };

    const program = new Command().name("daoflow");
    program.addCommand(installCommand());
    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "install",
        "--dir",
        installDir,
        "--workflow-profile",
        "lean",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: false,
      code: "COMPOSE_FETCH_FAILED"
    });
    expect(readFileSync(join(installDir, ".env"), "utf8")).toBe(existingEnv);
    expect(readFileSync(join(installDir, "docker-compose.yml"), "utf8")).toBe(existingCompose);
    expect(commands).toEqual(["docker info"]);
  });
});
