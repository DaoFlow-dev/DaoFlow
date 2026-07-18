import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand, installRuntime } from "./commands/install";
import { TEMPORAL_WORKER_CONNECTED_DETAIL } from "./install-health";
import { captureCommandExecution } from "./login-test-helpers";
import { generateEnvFile, parseEnvFile } from "./templates";

const originalInitialAdminEmail = process.env.DAOFLOW_INITIAL_ADMIN_EMAIL;
const originalInitialAdminPassword = process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD;
const originalInstallRuntime = {
  checkDocker: installRuntime.checkDocker,
  exec: installRuntime.exec,
  fetch: installRuntime.fetch,
  fetchComposeYml: installRuntime.fetchComposeYml,
  prompt: installRuntime.prompt,
  promptSelect: installRuntime.promptSelect,
  sleep: installRuntime.sleep
};

function readyResponse(): Response {
  return new Response(
    JSON.stringify({
      status: "ready",
      checks: [{ name: "workers", detail: TEMPORAL_WORKER_CONNECTED_DETAIL }]
    }),
    { status: 200 }
  );
}

describe("install workflow profile changes", () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), "daoflow-cli-install-profile-switch-"));
    delete process.env.DAOFLOW_INITIAL_ADMIN_EMAIL;
    delete process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD;
    installRuntime.checkDocker = () => ({
      available: true,
      compose: true,
      version: "Docker version 26.0.0"
    });
    installRuntime.exec = () => "";
    installRuntime.fetch = () => Promise.resolve(readyResponse());
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
    if (originalInitialAdminEmail) {
      process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = originalInitialAdminEmail;
    } else {
      delete process.env.DAOFLOW_INITIAL_ADMIN_EMAIL;
    }
    if (originalInitialAdminPassword) {
      process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = originalInitialAdminPassword;
    } else {
      delete process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD;
    }
    rmSync(installDir, { recursive: true, force: true });
  });

  test("preserves the inferred Temporal profile for legacy installations", async () => {
    writeFileSync(
      join(installDir, ".env"),
      generateEnvFile({
        version: "0.2.0",
        domain: "deploy.example.com",
        port: 3000,
        initialAdminEmail: "existing-owner@example.com",
        initialAdminPassword: "existing-owner-secret",
        postgresPassword: "pg-existing-secret",
        temporalPostgresPassword: "temporal-existing-secret",
        authSecret: "auth-existing-secret",
        encryptionKey: "enc-existing-secret",
        workflowProfile: "temporal"
      })
        .replace(/^DAOFLOW_WORKFLOW_PROFILE=.*\n/m, "")
        .replace(/^COMPOSE_PROFILES=.*\n/m, "")
    );
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
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.logs[0])).toMatchObject({ ok: true, workflowProfile: "temporal" });
    expect(parseEnvFile(readFileSync(join(installDir, ".env"), "utf8"))).toMatchObject({
      DAOFLOW_WORKFLOW_PROFILE: "temporal",
      COMPOSE_PROFILES: "temporal",
      DAOFLOW_ENABLE_TEMPORAL: "true"
    });
    expect(commands).toContain("docker compose --profile temporal up -d temporal");
  });

  test("switches from Temporal to lean without deleting Temporal data", async () => {
    writeFileSync(
      join(installDir, ".env"),
      generateEnvFile({
        version: "0.2.0",
        domain: "deploy.example.com",
        port: 3000,
        initialAdminEmail: "existing-owner@example.com",
        initialAdminPassword: "existing-owner-secret",
        postgresPassword: "pg-existing-secret",
        temporalPostgresPassword: "temporal-existing-secret",
        authSecret: "auth-existing-secret",
        encryptionKey: "enc-existing-secret",
        workflowProfile: "temporal"
      })
    );
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

    expect(result.exitCode).toBe(0);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.errors[0])).toEqual({
      ok: true,
      event: "workflow-profile-plan",
      data: {
        workflowProfilePlan: {
          change: "temporal-to-lean",
          from: "temporal",
          to: "lean",
          services: {
            added: [],
            removed: ["temporal-ui", "temporal", "temporal-postgresql"]
          },
          preservedVolumes: [
            "pgdata",
            "redisdata",
            "daoflow-staging",
            "daoflow-ssh",
            "temporal-pgdata"
          ]
        }
      }
    });
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: true,
      workflowProfile: "lean",
      workflowProfileChange: "temporal-to-lean",
      workflowProfilePlan: {
        services: {
          added: [],
          removed: ["temporal-ui", "temporal", "temporal-postgresql"]
        }
      }
    });
    expect(commands).toContain(
      "docker compose --profile temporal --profile temporal-ui rm --stop --force temporal temporal-postgresql temporal-ui"
    );
    expect(commands.some((command) => command.includes("down -v"))).toBe(false);
    expect(parseEnvFile(readFileSync(join(installDir, ".env"), "utf8"))).toMatchObject({
      DAOFLOW_WORKFLOW_PROFILE: "lean",
      COMPOSE_PROFILES: "",
      DAOFLOW_ENABLE_TEMPORAL: "false",
      TEMPORAL_POSTGRES_PASSWORD: "temporal-existing-secret"
    });
  });

  test("shows a profile change plan before a non-interactive human switch", async () => {
    writeFileSync(
      join(installDir, ".env"),
      generateEnvFile({
        version: "0.2.0",
        domain: "deploy.example.com",
        port: 3000,
        initialAdminEmail: "existing-owner@example.com",
        initialAdminPassword: "existing-owner-secret",
        workflowProfile: "temporal"
      })
    );

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
        "--yes"
      ]);
    });

    expect(result.exitCode).toBe(0);
    expect(result.errors).toContain("Workflow profile change plan:");
    expect(result.errors).toContain(
      "  Services to remove: temporal-ui, temporal, temporal-postgresql"
    );
    expect(result.errors).toContain(
      "  Volumes preserved: pgdata, redisdata, daoflow-staging, daoflow-ssh, temporal-pgdata"
    );
  });
});
