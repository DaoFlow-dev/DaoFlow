import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { envCommand } from "./commands/env";
import { registerConfigCommand } from "./commands/config";
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
});
