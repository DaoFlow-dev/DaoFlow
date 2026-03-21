import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { runCommandAction } from "./command-action";

class ExitSignal extends Error {
  constructor(readonly code: number) {
    super(`process.exit(${code})`);
  }
}

async function captureExecution(
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

describe("runCommandAction", () => {
  test("prints quiet output for non-JSON success results", async () => {
    const command = new Command("deploy");
    command.setOptionValue("quiet", true);

    const result = await captureExecution(async () => {
      await runCommandAction({
        command,
        action: (ctx) => {
          return Promise.resolve(
            ctx.success(
              { id: "dep_123" },
              {
                quiet: () => "dep_123",
                human: () => {
                  console.log("should not render");
                }
              }
            )
          );
        }
      });
    });

    expect(result.exitCode).toBeNull();
    expect(result.errors).toEqual([]);
    expect(result.logs).toEqual(["dep_123"]);
  });

  test("maps scope denied failures to exit code 2 with structured JSON", async () => {
    const command = new Command("deploy");
    command.setOptionValue("json", true);

    const result = await captureExecution(async () => {
      await runCommandAction({
        command,
        action: () => {
          const error = Object.assign(new Error("Missing required scope(s): deploy:start"), {
            code: "FORBIDDEN",
            data: {
              cause: {
                code: "SCOPE_DENIED",
                requiredScopes: ["deploy:start"],
                grantedScopes: ["deploy:read"]
              }
            }
          });
          return Promise.reject(error);
        }
      });
    });

    expect(result.exitCode).toBe(2);
    expect(result.errors).toEqual([]);
    expect(JSON.parse(result.logs[0])).toEqual({
      ok: false,
      error: "Missing required scope(s): deploy:start",
      code: "SCOPE_DENIED",
      requiredScopes: ["deploy:start"],
      grantedScopes: ["deploy:read"]
    });
  });
});
