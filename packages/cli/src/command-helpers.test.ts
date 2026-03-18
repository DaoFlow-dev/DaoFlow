import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { emitJsonError, emitJsonSuccess, resolveCommandJsonOption } from "./command-helpers";

function captureConsoleLog(fn: () => void): string[] {
  const original = console.log;
  const messages: string[] = [];
  console.log = (...args: unknown[]) => {
    messages.push(args.map((arg) => String(arg)).join(" "));
  };

  try {
    fn();
  } finally {
    console.log = original;
  }

  return messages;
}

describe("resolveCommandJsonOption", () => {
  test("reads the root global --json flag from a subcommand", async () => {
    let observed = false;

    const program = new Command();
    program.exitOverride();
    program.option("--json", "Output as JSON");
    program.command("status").action((_opts, command: Command) => {
      observed = resolveCommandJsonOption(command);
    });

    await program.parseAsync(["node", "daoflow", "--json", "status"]);

    expect(observed).toBe(true);
  });

  test("prefers a local --json option on the current command", async () => {
    let observed = false;

    const program = new Command();
    program.exitOverride();
    program.option("--json", "Output as JSON");
    program
      .command("services")
      .option("--json", "Output as JSON")
      .action((opts: { json?: boolean }, command: Command) => {
        observed = resolveCommandJsonOption(command, opts.json);
      });

    await program.parseAsync(["node", "daoflow", "services", "--json"]);

    expect(observed).toBe(true);
  });

  test("returns false when neither local nor global --json is set", async () => {
    let observed = true;

    const program = new Command();
    program.exitOverride();
    program.option("--json", "Output as JSON");
    program
      .command("projects")
      .command("list")
      .action((_opts, command: Command) => {
        observed = resolveCommandJsonOption(command);
      });

    await program.parseAsync(["node", "daoflow", "projects", "list"]);

    expect(observed).toBe(false);
  });

  test("emitJsonSuccess wraps data in the standard envelope", () => {
    const [output] = captureConsoleLog(() => {
      emitJsonSuccess({ deploymentId: "dep_123", queued: true });
    });

    expect(JSON.parse(output)).toEqual({
      ok: true,
      data: { deploymentId: "dep_123", queued: true }
    });
  });

  test("emitJsonError emits structured errors with optional fields", () => {
    const [output] = captureConsoleLog(() => {
      emitJsonError("Permission denied", "SCOPE_DENIED", { requiredScope: "deploy:start" });
    });

    expect(JSON.parse(output)).toEqual({
      ok: false,
      error: "Permission denied",
      code: "SCOPE_DENIED",
      requiredScope: "deploy:start"
    });
  });
});
