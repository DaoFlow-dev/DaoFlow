import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandActionError } from "./command-action";
import {
  buildInstallErrorPayload,
  installCommand,
  installRuntime,
  resolveInitialAdminCredentials
} from "./commands/install";
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

  test("preserves existing secrets and settings when re-running install in place", async () => {
    writeFileSync(
      join(installDir, ".env"),
      `${generateEnvFile({
        version: "0.2.0",
        domain: "deploy.example.com",
        port: 8080,
        scheme: "http",
        initialAdminEmail: "existing-owner@example.com",
        initialAdminPassword: "existing-owner-secret",
        postgresPassword: "pg-existing-secret",
        temporalPostgresPassword: "temporal-existing-secret",
        authSecret: "auth-existing-secret",
        encryptionKey: "enc-existing-secret"
      })}
SMTP_HOST=smtp.example.com
DEPLOY_TIMEOUT_MS=900000
`
    );

    installRuntime.fetch = (url: string) => {
      expect(url).toBe("http://127.0.0.1:8080/trpc/health");
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
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
    const envFile = parseEnvFile(readFileSync(join(installDir, ".env"), "utf8"));
    expect(envFile.BETTER_AUTH_URL).toBe("http://deploy.example.com:8080");
    expect(envFile.DAOFLOW_PORT).toBe("8080");
    expect(envFile.DAOFLOW_INITIAL_ADMIN_EMAIL).toBe("existing-owner@example.com");
    expect(envFile.DAOFLOW_INITIAL_ADMIN_PASSWORD).toBe("existing-owner-secret");
    expect(envFile.POSTGRES_PASSWORD).toBe("pg-existing-secret");
    expect(envFile.TEMPORAL_POSTGRES_PASSWORD).toBe("temporal-existing-secret");
    expect(envFile.BETTER_AUTH_SECRET).toBe("auth-existing-secret");
    expect(envFile.ENCRYPTION_KEY).toBe("enc-existing-secret");
    expect(envFile.SMTP_HOST).toBe("smtp.example.com");
    expect(envFile.DEPLOY_TIMEOUT_MS).toBe("900000");
  });

  test("returns a structured error when the install port is invalid", async () => {
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
        "--port",
        "abc",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: 'Invalid port "abc". Use an integer between 1 and 65535.',
      code: "INVALID_PORT"
    });
  });

  test("rewrites BETTER_AUTH_URL from tailscale exposure output", async () => {
    process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = "owner@example.com";
    process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = "env-secret-123";

    installRuntime.exec = (command: string) => {
      if (command.startsWith("command -v tailscale")) {
        return "/usr/bin/tailscale\n";
      }
      if (command.startsWith("tailscale serve --bg 3000")) {
        return "Available within your tailnet:\nhttps://daoflow-node.tail123.ts.net\n";
      }
      if (command.startsWith("docker compose")) {
        return "";
      }

      throw new Error(`Unexpected command: ${command}`);
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
        "--expose",
        "tailscale",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: true,
      url: "https://daoflow-node.tail123.ts.net",
      exposure: {
        ok: true,
        mode: "tailscale-serve",
        access: "tailnet",
        url: "https://daoflow-node.tail123.ts.net"
      }
    });

    const envFile = parseEnvFile(readFileSync(join(installDir, ".env"), "utf8"));
    expect(envFile.BETTER_AUTH_URL).toBe("https://daoflow-node.tail123.ts.net");
  });

  test("interactive install upgrades localhost to https when the user enters a public domain", async () => {
    installRuntime.prompt = (() => {
      const answers = [
        installDir,
        "deploy.example.com",
        "3000",
        "none",
        "owner@example.com",
        "interactive-secret-123",
        "auto",
        "y"
      ];

      return () => Promise.resolve(String(answers.shift() ?? ""));
    })();

    const program = new Command().name("daoflow");
    program.addCommand(installCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync(["node", "daoflow", "install", "--json"]);
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: true,
      url: "https://deploy.example.com:3000"
    });

    const envFile = parseEnvFile(readFileSync(join(installDir, ".env"), "utf8"));
    expect(envFile.BETTER_AUTH_URL).toBe("https://deploy.example.com:3000");
  });

  test("install error payload keeps canonical fields ahead of extra metadata", () => {
    const payload = buildInstallErrorPayload(
      new CommandActionError("Install failed", {
        code: "START_FAILED",
        extra: {
          ok: true,
          error: "overridden",
          code: "OVERRIDDEN",
          detail: "kept"
        }
      })
    );

    expect(payload).toEqual({
      ok: false,
      error: "Install failed",
      code: "START_FAILED",
      detail: "kept"
    });
  });
});
