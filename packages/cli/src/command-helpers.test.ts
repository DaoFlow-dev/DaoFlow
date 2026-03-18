import { describe, expect, test } from "bun:test";
import { Command } from "commander";
import { resolveCommandJsonOption } from "./command-helpers";

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
});
