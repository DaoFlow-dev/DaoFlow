import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { installCommand, installRuntime, resolveInitialAdminCredentials } from "./commands/install";
import { captureCommandExecution } from "./login-test-helpers";
import { parseEnvFile } from "./templates";

const originalInitialAdminEmail = process.env.DAOFLOW_INITIAL_ADMIN_EMAIL;
const originalInitialAdminPassword = process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD;
const originalInstallRuntime = {
  checkDocker: installRuntime.checkDocker,
  exec: installRuntime.exec,
  fetch: installRuntime.fetch,
  fetchComposeYml: installRuntime.fetchComposeYml,
  prompt: installRuntime.prompt,
  sleep: installRuntime.sleep
};

describe("install command", () => {
  let installDir: string;

  beforeEach(() => {
    installDir = mkdtempSync(join(tmpdir(), "daoflow-cli-install-"));
    delete process.env.DAOFLOW_INITIAL_ADMIN_EMAIL;
    delete process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD;

    installRuntime.checkDocker = () => ({
      available: true,
      compose: true,
      version: "Docker version 26.0.0"
    });
    installRuntime.exec = () => "";
    installRuntime.fetch = (url: string) => {
      expect(url).toBe("http://127.0.0.1:3000/trpc/health");
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    installRuntime.fetchComposeYml = () =>
      Promise.resolve("services:\n  daoflow:\n    image: ghcr.io/daoflow-dev/daoflow:latest\n");
    installRuntime.prompt = () => {
      throw new Error("prompt should not be used in non-interactive tests");
    };
    installRuntime.sleep = () => Promise.resolve();
  });

  afterEach(() => {
    installRuntime.checkDocker = originalInstallRuntime.checkDocker;
    installRuntime.exec = originalInstallRuntime.exec;
    installRuntime.fetch = originalInstallRuntime.fetch;
    installRuntime.fetchComposeYml = originalInstallRuntime.fetchComposeYml;
    installRuntime.prompt = originalInstallRuntime.prompt;
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

  test("resolveInitialAdminCredentials prefers flags and fills missing values from env", () => {
    const resolved = resolveInitialAdminCredentials(
      { email: "flag-owner@example.com" },
      {
        DAOFLOW_INITIAL_ADMIN_EMAIL: "env-owner@example.com",
        DAOFLOW_INITIAL_ADMIN_PASSWORD: "env-secret-123"
      }
    );

    expect(resolved).toEqual({
      email: "flag-owner@example.com",
      password: "env-secret-123",
      source: "mixed"
    });
  });

  test("uses bootstrap env vars when flags are omitted and writes them into .env", async () => {
    process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = "owner@example.com";
    process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = "env-secret-123";

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
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: true,
      directory: installDir,
      domain: "localhost",
      port: 3000,
      healthy: true
    });

    const envFile = parseEnvFile(readFileSync(join(installDir, ".env"), "utf8"));
    expect(envFile.DAOFLOW_INITIAL_ADMIN_EMAIL).toBe("owner@example.com");
    expect(envFile.DAOFLOW_INITIAL_ADMIN_PASSWORD).toBe("env-secret-123");
  });

  test("returns a structured error when bootstrap email is missing", async () => {
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
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Admin email is required (--email or DAOFLOW_INITIAL_ADMIN_EMAIL)",
      code: "MISSING_EMAIL"
    });
  });
});
