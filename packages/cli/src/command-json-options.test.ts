import { describe, expect, test } from "bun:test";
import type { Command } from "commander";
import { doctorCommand } from "./commands/doctor";
import { envCommand } from "./commands/env";
import { loginCommand } from "./commands/login";
import { logsCommand } from "./commands/logs";
import { planCommand } from "./commands/plan";

function hasLongOption(command: Command, longFlag: string): boolean {
  return command.options.some((option) => option.long === longFlag);
}

function getSubcommand(command: Command, name: string): Command {
  const child = command.commands.find((candidate) => candidate.name() === name);
  expect(child).toBeDefined();
  return child as Command;
}

describe("CLI JSON option coverage", () => {
  test("login declares --json", () => {
    expect(hasLongOption(loginCommand(), "--json")).toBe(true);
  });

  test("doctor declares --json", () => {
    expect(hasLongOption(doctorCommand(), "--json")).toBe(true);
  });

  test("logs declares --json", () => {
    expect(hasLongOption(logsCommand(), "--json")).toBe(true);
  });

  test("plan declares --json", () => {
    expect(hasLongOption(planCommand(), "--json")).toBe(true);
  });

  test("env pull and env push declare --json", () => {
    const env = envCommand();
    expect(hasLongOption(getSubcommand(env, "pull"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(env, "push"), "--json")).toBe(true);
  });
});
