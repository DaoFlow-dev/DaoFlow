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

function readyResponse(workerDetail = TEMPORAL_WORKER_CONNECTED_DETAIL): Response {
  return new Response(
    JSON.stringify({
      status: "ready",
      checks: [{ name: "workers", detail: workerDetail }]
    }),
    { status: 200 }
  );
}

describe("install workflow profiles", () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), "daoflow-cli-install-profile-"));
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

  test("defaults non-interactive installs to the lean profile", async () => {
    process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = "owner@example.com";
    process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = "env-secret-123";
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
    expect(JSON.parse(result.logs[0])).toMatchObject({ ok: true, workflowProfile: "lean" });
    expect(parseEnvFile(readFileSync(join(installDir, ".env"), "utf8"))).toMatchObject({
      DAOFLOW_WORKFLOW_PROFILE: "lean",
      COMPOSE_PROFILES: "",
      DAOFLOW_ENABLE_TEMPORAL: "false"
    });
    expect(commands).toContain("docker compose pull");
    expect(commands).toContain("docker compose up -d");
    expect(commands.some((command) => command.includes("--profile temporal"))).toBe(false);
  });

  test("starts Temporal explicitly when the temporal profile is selected", async () => {
    process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = "owner@example.com";
    process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = "env-secret-123";
    const commands: string[] = [];
    let temporalHealthChecks = 0;
    installRuntime.exec = (command: string) => {
      commands.push(command);
      if (command.includes("temporal operator cluster health")) {
        temporalHealthChecks += 1;
        if (temporalHealthChecks === 1) {
          throw new Error("Temporal is still starting");
        }
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
        "temporal",
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
    expect(
      parseEnvFile(readFileSync(join(installDir, ".env"), "utf8")).TEMPORAL_POSTGRES_PASSWORD
    ).not.toBe("");
    expect(commands).toContain("docker compose --profile temporal pull");
    expect(commands).toContain("docker compose --profile temporal up -d temporal");
    expect(commands).toContain(
      "docker compose --profile temporal exec -T temporal temporal operator cluster health --address temporal:7233"
    );
    expect(commands).toContain("docker compose --profile temporal up -d daoflow");
    expect(temporalHealthChecks).toBe(2);
  });

  test("fails before starting DaoFlow when Temporal cluster health times out", async () => {
    process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = "owner@example.com";
    process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = "env-secret-123";
    const commands: string[] = [];
    installRuntime.exec = (command: string) => {
      commands.push(command);
      if (command.includes("temporal operator cluster health")) {
        throw new Error("Temporal is still starting");
      }
      return "";
    };
    installRuntime.fetch = () => {
      throw new Error("DaoFlow must not start before Temporal is healthy");
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
        "temporal",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: false,
      code: "TEMPORAL_CLUSTER_HEALTH_TIMEOUT"
    });
    expect(commands).toContain("docker compose --profile temporal up -d temporal");
    expect(commands).not.toContain("docker compose --profile temporal up -d daoflow");
  });

  test("rejects a Temporal workflow profile with an empty database password before Compose runs", async () => {
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
      }).replace(
        "TEMPORAL_POSTGRES_PASSWORD=temporal-existing-secret",
        "TEMPORAL_POSTGRES_PASSWORD="
      )
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

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: false,
      code: "MISSING_TEMPORAL_POSTGRES_PASSWORD"
    });
    expect(commands).toEqual(["docker info"]);
  });

  test("rejects a Temporal install when readiness reports a legacy worker", async () => {
    process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = "owner@example.com";
    process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = "env-secret-123";
    const commands: string[] = [];
    installRuntime.exec = (command: string) => {
      commands.push(command);
      return "";
    };
    installRuntime.fetch = () =>
      Promise.resolve(readyResponse("Legacy execution worker connected."));

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
        "temporal",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: false,
      code: "TEMPORAL_WORKER_NOT_READY"
    });
    expect(commands).toContain("docker compose --profile temporal up -d daoflow");
  });
});
