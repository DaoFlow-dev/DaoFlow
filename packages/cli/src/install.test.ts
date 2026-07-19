import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { Command } from "commander";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { CommandActionError } from "./command-action";
import { installCommand, installRuntime, resolveInitialAdminCredentials } from "./commands/install";
import { getDashboardExposureStatePath } from "./install-exposure-state";
import { buildInstallErrorPayload } from "./install-output";
import { captureCommandExecution } from "./login-test-helpers";
import { generateEnvFile, parseEnvFile } from "./templates";
import { CLI_VERSION } from "./version";

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

describe("install command", () => {
  let installDir: string;
  let requestedComposeVersions: Array<string | undefined>;

  beforeEach(() => {
    requestedComposeVersions = [];
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
      expect(url).toBe("http://127.0.0.1:3000/ready");
      return Promise.resolve(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    };
    installRuntime.fetchComposeYml = (version?: string) => {
      requestedComposeVersions.push(version);
      return Promise.resolve(
        "services:\n  daoflow:\n    image: ghcr.io/daoflow-dev/daoflow:latest\n"
      );
    };
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
    expect(requestedComposeVersions).toEqual([CLI_VERSION]);
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
        encryptionKey: "enc-existing-secret",
        recoveryEncryptionKey: "recovery-existing-secret",
        preservedEnv: {
          DAOFLOW_DATABASE_NAME: "existing_control_plane"
        }
      })}
SMTP_HOST=smtp.example.com
DEPLOY_TIMEOUT_MS=900000
`
    );

    installRuntime.fetch = (url: string) => {
      expect(url).toBe("http://127.0.0.1:8080/ready");
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
    expect(envFile.DAOFLOW_RECOVERY_ENCRYPTION_KEY).toBe("recovery-existing-secret");
    expect(envFile.DAOFLOW_DATABASE_NAME).toBe("existing_control_plane");
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

  test("returns a structured error when readiness never succeeds", async () => {
    process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = "owner@example.com";
    process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = "env-secret-123";
    installRuntime.fetch = (url: string) => {
      expect(url).toBe("http://127.0.0.1:3000/ready");
      return Promise.resolve(new Response(JSON.stringify({ ok: false }), { status: 503 }));
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
    const parsed = JSON.parse(result.logs[0]) as { ok: boolean; error: string; code: string };
    expect(parsed).toMatchObject({
      ok: false,
      code: "INSTALL_READINESS_TIMEOUT",
      directory: installDir,
      port: 3000
    });
    expect(parsed.error).toContain("DaoFlow did not become ready before the installer timeout.");
  });

  test("rewrites BETTER_AUTH_URL from tailscale exposure output", async () => {
    process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = "owner@example.com";
    process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = "env-secret-123";

    installRuntime.exec = (command: string) => {
      if (command === "docker info") {
        return "";
      }
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

  test("configures a built-in Traefik dashboard edge when requested", async () => {
    process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = "owner@example.com";
    process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = "env-secret-123";

    installRuntime.fetch = (url: string) => {
      expect(url).toBe("http://127.0.0.1:3000/ready");
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
        "--domain",
        "deploy.example.com",
        "--expose",
        "traefik",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: true,
      url: "https://deploy.example.com",
      exposure: {
        ok: true,
        mode: "traefik",
        access: "public",
        url: "https://deploy.example.com"
      }
    });

    const envFile = parseEnvFile(readFileSync(join(installDir, ".env"), "utf8"));
    expect(envFile.BETTER_AUTH_URL).toBe("https://deploy.example.com");
    expect(envFile.DAOFLOW_DOMAIN).toBe("deploy.example.com");
    expect(envFile.DAOFLOW_ACME_EMAIL).toBe("owner@example.com");
    expect(envFile.DAOFLOW_PROXY_NETWORK).toBe("daoflow-proxy");

    const composeFile = readFileSync(join(installDir, "docker-compose.yml"), "utf8");
    expect(composeFile).toContain("traefik:v3.6.7");
    expect(composeFile).toContain("${DAOFLOW_BIND:-127.0.0.1}:${DAOFLOW_PORT:-3000}:3000");
    expect(composeFile).toContain("DAOFLOW_PROXY_NETWORK:-daoflow-proxy");
  });

  test("returns a structured error when exposed auth URL restart never becomes ready", async () => {
    process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = "owner@example.com";
    process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = "env-secret-123";

    installRuntime.exec = (command: string) => {
      if (command === "docker info") {
        return "";
      }
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

    let readinessChecks = 0;
    installRuntime.fetch = (url: string) => {
      expect(url).toBe("http://127.0.0.1:3000/ready");
      readinessChecks += 1;
      const status = readinessChecks === 1 ? 200 : 503;
      return Promise.resolve(new Response(JSON.stringify({ ok: status === 200 }), { status }));
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

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error:
        "DaoFlow did not become ready after applying the exposed auth URL. Run 'docker compose logs daoflow' in the install directory and retry.",
      code: "INSTALL_READINESS_TIMEOUT",
      directory: installDir,
      port: 3000
    });
  });

  test("configures a Cloudflare Tunnel sidecar when requested", async () => {
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
        "--domain",
        "deploy.example.com",
        "--cloudflare-tunnel",
        "--cloudflare-tunnel-token",
        "cf-token-123",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: true,
      url: "https://deploy.example.com",
      cloudflareTunnel: {
        publicUrl: "https://deploy.example.com",
        guide: [
          expect.stringContaining("deploy.example.com"),
          "Use service type HTTP.",
          "Use origin URL http://daoflow:3000.",
          expect.stringContaining("BETTER_AUTH_URL")
        ]
      }
    });

    const envFile = parseEnvFile(readFileSync(join(installDir, ".env"), "utf8"));
    expect(envFile.BETTER_AUTH_URL).toBe("https://deploy.example.com");
    expect(envFile.CLOUDFLARE_TUNNEL_TOKEN).toBe("cf-token-123");
    expect(envFile.DAOFLOW_DOMAIN).toBe("deploy.example.com");

    const composeFile = readFileSync(join(installDir, "docker-compose.yml"), "utf8");
    expect(composeFile).toContain("cloudflare/cloudflared:latest");
    expect(composeFile).toContain("CLOUDFLARE_TUNNEL_TOKEN");
    expect(composeFile).toContain("${DAOFLOW_BIND:-127.0.0.1}:${DAOFLOW_PORT:-3000}:3000");
  });

  test("returns a structured error when Cloudflare Tunnel is enabled without a token", async () => {
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
        "--domain",
        "deploy.example.com",
        "--cloudflare-tunnel",
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error:
        "A Cloudflare tunnel token is required when Cloudflare Tunnel is enabled (--cloudflare-tunnel-token or CLOUDFLARE_TUNNEL_TOKEN).",
      code: "INVALID_CLOUDFLARE_TUNNEL_CONFIGURATION"
    });
  });

  test("re-running a Traefik install keeps health checks on the local DaoFlow port", async () => {
    writeFileSync(
      join(installDir, ".env"),
      generateEnvFile({
        version: "0.2.0",
        domain: "deploy.example.com",
        port: 3000,
        scheme: "https",
        exposureMode: "traefik",
        acmeEmail: "ops@example.com",
        initialAdminEmail: "existing-owner@example.com",
        initialAdminPassword: "existing-owner-secret",
        postgresPassword: "pg-existing-secret",
        temporalPostgresPassword: "temporal-existing-secret",
        authSecret: "auth-existing-secret",
        encryptionKey: "enc-existing-secret"
      }).replace(
        "BETTER_AUTH_URL=https://deploy.example.com:3000",
        "BETTER_AUTH_URL=https://deploy.example.com"
      )
    );

    mkdirSync(join(installDir, ".daoflow"), { recursive: true });
    writeFileSync(
      getDashboardExposureStatePath(installDir),
      `${JSON.stringify(
        {
          mode: "traefik",
          access: "public",
          url: "https://deploy.example.com",
          detail: "Traefik is already configured.",
          updatedAt: new Date(0).toISOString()
        },
        null,
        2
      )}\n`
    );

    installRuntime.fetch = (url: string) => {
      expect(url).toBe("http://127.0.0.1:3000/ready");
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
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: true,
      url: "https://deploy.example.com",
      exposure: {
        ok: true,
        mode: "traefik",
        url: "https://deploy.example.com"
      }
    });
  });

  test("interactive install upgrades localhost to https when the user enters a public domain", async () => {
    // Prompt order: dir, profile, exposure, CF tunnel, domain, port, email, password, DB passwords, confirm
    installRuntime.prompt = (() => {
      const answers = [
        installDir,
        "n",
        "deploy.example.com",
        "3000",
        "owner@example.com",
        "interactive-secret-123",
        "auto",
        "y"
      ];

      return () => Promise.resolve(String(answers.shift() ?? ""));
    })();
    installRuntime.promptSelect = (() => {
      const choices = ["lean", "none"];
      return () => Promise.resolve(choices.shift() as never);
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

  test("Docker permission denied produces a structured error", async () => {
    process.env.DAOFLOW_INITIAL_ADMIN_EMAIL = "owner@example.com";
    process.env.DAOFLOW_INITIAL_ADMIN_PASSWORD = "env-secret-123";

    installRuntime.exec = (command: string) => {
      if (command === "docker info") {
        throw new Error(
          "Got permission denied while trying to connect to the Docker daemon socket at unix:///var/run/docker.sock: permission denied"
        );
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
        "--yes",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: false,
      code: "DOCKER_PERMISSION_DENIED"
    });
  });

  test("interactive install re-prompts on invalid domain for traefik", async () => {
    // Answers: dir, profile and exposure via promptSelect, CF tunnel = n,
    // domain = localhost (invalid, re-prompted), domain = deploy.example.com (valid),
    // port, email, password, ACME email, DB passwords, confirm
    installRuntime.prompt = (() => {
      const answers = [
        installDir,
        "n",
        "localhost",
        "deploy.example.com",
        "3000",
        "owner@example.com",
        "interactive-secret-123",
        "owner@example.com",
        "auto",
        "y"
      ];

      return () => Promise.resolve(String(answers.shift() ?? ""));
    })();
    installRuntime.promptSelect = (() => {
      const choices = ["lean", "traefik"];
      return () => Promise.resolve(choices.shift() as never);
    })();

    const program = new Command().name("daoflow");
    program.addCommand(installCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync(["node", "daoflow", "install", "--json"]);
    });

    expect(result.exitCode).toBe(0);
    expect(JSON.parse(result.logs[0])).toMatchObject({
      ok: true,
      url: "https://deploy.example.com"
    });

    const envFile = parseEnvFile(readFileSync(join(installDir, ".env"), "utf8"));
    expect(envFile.BETTER_AUTH_URL).toBe("https://deploy.example.com");
    expect(envFile.DAOFLOW_DOMAIN).toBe("deploy.example.com");
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
