import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { backupCommand } from "./commands/backup";
import { deployCommand } from "./commands/deploy";
import { envCommand } from "./commands/env";
import { registerConfigCommand } from "./commands/config";
import { planCommand } from "./commands/plan";
import { tokenCommand } from "./commands/token";

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

async function captureCommandExecution(
  run: () => Promise<void>
): Promise<{ logs: string[]; errors: string[]; exitCode: number | null }> {
  const originalLog = console.log;
  const originalError = console.error;
  const originalExit = process.exit.bind(process);
  const logs: string[] = [];
  const errors: string[] = [];
  let exitCode: number | null = null;

  console.log = (...args: unknown[]) => {
    logs.push(args.map((arg) => String(arg)).join(" "));
  };
  console.error = (...args: unknown[]) => {
    errors.push(args.map((arg) => String(arg)).join(" "));
  };
  process.exit = ((code?: number) => {
    throw new ExitSignal(code ?? 0);
  }) as typeof process.exit;

  try {
    await run();
  } catch (error) {
    if (error instanceof ExitSignal) {
      exitCode = error.code;
    } else {
      throw error;
    }
  } finally {
    console.log = originalLog;
    console.error = originalError;
    process.exit = originalExit;
  }

  return { logs, errors, exitCode };
}

async function withTempConfigDir<T>(
  configContent: string,
  run: (configDir: string) => Promise<T>
): Promise<T> {
  const originalCwd = process.cwd();
  const configDir = mkdtempSync(join(tmpdir(), "daoflow-cli-config-"));

  try {
    writeFileSync(join(configDir, "daoflow.config.json"), configContent, "utf8");
    process.chdir(configDir);
    return await run(configDir);
  } finally {
    process.chdir(originalCwd);
    rmSync(configDir, { recursive: true, force: true });
  }
}

async function withTempHome<T>(run: (homeDir: string) => Promise<T>): Promise<T> {
  const originalHome = process.env.HOME;
  const originalUrl = process.env.DAOFLOW_URL;
  const originalToken = process.env.DAOFLOW_TOKEN;
  const homeDir = mkdtempSync(join(tmpdir(), "daoflow-cli-home-"));

  delete process.env.DAOFLOW_URL;
  delete process.env.DAOFLOW_TOKEN;
  process.env.HOME = homeDir;

  try {
    return await run(homeDir);
  } finally {
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

    rmSync(homeDir, { recursive: true, force: true });
  }
}

describe("CLI JSON contract", () => {
  test("config generate-vapid emits the standard success envelope", async () => {
    const program = new Command().name("daoflow");
    registerConfigCommand(program);

    const result = await captureCommandExecution(async () => {
      await program.parseAsync(["node", "daoflow", "config", "generate-vapid", "--json"]);
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);

    const payload = JSON.parse(result.logs[0]) as {
      ok: boolean;
      data: { publicKey: string; privateKey: string; instructions: Record<string, string> };
    };

    expect(payload.ok).toBe(true);
    expect(payload.data.publicKey.length).toBeGreaterThan(0);
    expect(payload.data.privateKey.length).toBeGreaterThan(0);
    expect(payload.data.instructions).toEqual({
      server: "Set VAPID_PUBLIC_KEY and VAPID_PRIVATE_KEY environment variables",
      client: "Set VITE_VAPID_PUBLIC_KEY in client .env"
    });
  });

  test("env set in JSON mode still requires --yes", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(envCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "env",
        "set",
        "--env-id",
        "env_123",
        "--key",
        "API_URL",
        "--value",
        "https://example.com",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Set API_URL in environment env_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("backup restore in JSON mode still requires --yes", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(backupCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "backup",
        "restore",
        "--backup-run-id",
        "bkr_123",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "To restore from backup bkr_123, add --yes",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("backup run dry-run still emits JSON and exits 3 without --json", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(backupCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "backup",
        "run",
        "--policy",
        "pol_123",
        "--dry-run"
      ]);
    });

    expect(result.exitCode).toBe(3);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: true,
      data: {
        dryRun: true,
        action: "backup.run",
        policyId: "pol_123",
        message: "Would trigger one-off backup for policy pol_123"
      }
    });
  });

  test("backup list without --json reports API errors on stderr", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(backupCommand());

    const originalUrl = process.env.DAOFLOW_URL;
    const originalToken = process.env.DAOFLOW_TOKEN;

    const result = await withTempHome(async () => {
      process.env.DAOFLOW_URL = "http://127.0.0.1:9";
      process.env.DAOFLOW_TOKEN = "dfl_test_token";

      try {
        return await captureCommandExecution(async () => {
          await program.parseAsync(["node", "daoflow", "backup", "list"]);
        });
      } finally {
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
      }
    });

    expect(result.exitCode).toBe(1);
    expect(result.logs).toEqual([]);
    expect(result.errors).toHaveLength(1);
    const [errorLine] = result.errors;
    expect(() => JSON.parse(errorLine ?? "")).toThrow();
  });

  test("token create in JSON mode still requires --yes", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(tokenCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "token",
        "create",
        "--name",
        "ci-bot",
        "--preset",
        "agent:read-only",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Creating agent token ci-bot requires --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("token revoke in JSON mode still requires --yes", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(tokenCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync(["node", "daoflow", "token", "revoke", "--id", "tok_123", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Destructive operation — revoking token tok_123. Pass --yes to confirm.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("plan in JSON mode requires either --service or --compose", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(planCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync(["node", "daoflow", "plan", "--json"]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Either --service or --compose is required.",
      code: "INVALID_INPUT"
    });
  });

  test("compose plan in JSON mode requires --server", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(planCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "plan",
        "--compose",
        "./compose.yaml",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "--server is required for compose planning.",
      code: "INVALID_INPUT"
    });
  });

  test("plan in JSON mode rejects explicit service and compose targets together", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(planCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "plan",
        "--service",
        "svc_123",
        "--compose",
        "./compose.yaml",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Choose either --service or --compose, not both.",
      code: "INVALID_INPUT"
    });
  });

  test("compose plan in JSON mode rejects preview targeting", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(planCommand());

    const result = await captureCommandExecution(async () => {
      await program.parseAsync([
        "node",
        "daoflow",
        "plan",
        "--compose",
        "./compose.yaml",
        "--server",
        "srv_123",
        "--preview-branch",
        "feature/login",
        "--json"
      ]);
    });

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Preview targeting is only supported with --service planning.",
      code: "INVALID_INPUT"
    });
  });

  test("plan in JSON mode does not pollute stdout when a config file is present", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(planCommand());

    const result = await withTempConfigDir(JSON.stringify({ project: "demo" }), async () =>
      captureCommandExecution(async () => {
        await program.parseAsync(["node", "daoflow", "plan", "--json"]);
      })
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Either --service or --compose is required.",
      code: "INVALID_INPUT"
    });
  });

  test("deploy in JSON mode does not pollute stdout when a config file is present", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(deployCommand());

    const result = await withTempConfigDir(JSON.stringify({ project: "demo" }), async () =>
      captureCommandExecution(async () => {
        await program.parseAsync(["node", "daoflow", "deploy", "--json"]);
      })
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Either --service or --compose is required.",
      code: "INVALID_INPUT"
    });
  });

  test("compose deploy in JSON mode requires confirmation when local env_file assets need upload", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(deployCommand());

    const result = await withTempConfigDir(
      JSON.stringify({ project: "demo" }),
      async (configDir) => {
        writeFileSync(
          join(configDir, "compose.yaml"),
          [
            "services:",
            "  api:",
            "    image: nginx:alpine",
            "    env_file:",
            "      - ./runtime.env"
          ].join("\n"),
          "utf8"
        );
        writeFileSync(join(configDir, "runtime.env"), "API_TOKEN=secret\n", "utf8");

        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "deploy",
            "--compose",
            "./compose.yaml",
            "--server",
            "srv_123",
            "--json"
          ]);
        });
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error:
        "1 local env_file asset will be frozen (0.0MB, 3 files). Context will be bundled, uploaded to DaoFlow, and deployed on server srv_123. Pass --yes to confirm, or --dry-run to preview.",
      code: "CONFIRMATION_REQUIRED"
    });
  });

  test("compose plan in JSON mode rejects context roots that omit compose-relative local inputs", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(planCommand());

    const result = await withTempConfigDir(
      JSON.stringify({ project: "demo" }),
      async (configDir) => {
        const contextDir = join(configDir, "bundle");
        mkdirSync(join(configDir, "deploy"), { recursive: true });
        mkdirSync(contextDir, { recursive: true });
        writeFileSync(
          join(configDir, "deploy", "compose.yaml"),
          [
            "services:",
            "  api:",
            "    image: nginx:alpine",
            "    env_file:",
            "      - ./runtime.env"
          ].join("\n"),
          "utf8"
        );
        writeFileSync(join(configDir, "deploy", "runtime.env"), "API_TOKEN=secret\n", "utf8");

        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "plan",
            "--compose",
            "./deploy/compose.yaml",
            "--context",
            "./bundle",
            "--server",
            "srv_123",
            "--json"
          ]);
        });
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error:
        "env_file for service api (./runtime.env) resolves outside the configured --context root ./bundle. Widen --context so every local compose input is included in the upload bundle.",
      code: "INVALID_INPUT"
    });
  });

  test("compose deploy in JSON mode rejects context roots that omit compose-relative local inputs", async () => {
    const program = new Command().name("daoflow");
    program.addCommand(deployCommand());

    const result = await withTempConfigDir(
      JSON.stringify({ project: "demo" }),
      async (configDir) => {
        const contextDir = join(configDir, "bundle");
        mkdirSync(join(configDir, "deploy"), { recursive: true });
        mkdirSync(contextDir, { recursive: true });
        writeFileSync(
          join(configDir, "deploy", "compose.yaml"),
          [
            "services:",
            "  api:",
            "    image: nginx:alpine",
            "    env_file:",
            "      - ./runtime.env"
          ].join("\n"),
          "utf8"
        );
        writeFileSync(join(configDir, "deploy", "runtime.env"), "API_TOKEN=secret\n", "utf8");

        return await captureCommandExecution(async () => {
          await program.parseAsync([
            "node",
            "daoflow",
            "deploy",
            "--compose",
            "./deploy/compose.yaml",
            "--context",
            "./bundle",
            "--server",
            "srv_123",
            "--yes",
            "--json"
          ]);
        });
      }
    );

    expect(result.exitCode).toBe(1);
    expect(result.errors).toEqual([]);
    expect(result.logs).toHaveLength(1);
    const payload = JSON.parse(result.logs[0]) as { ok: boolean; error: string; code: string };
    expect(payload).toMatchObject({
      ok: false,
      code: "INVALID_INPUT"
    });
    expect(payload.error).toContain(
      "env_file for service api (./runtime.env) resolves outside the configured --context root"
    );
    expect(payload.error).toContain("Widen --context so every local compose input is included");
    expect(payload.error).toContain("bundle");
  });
});
