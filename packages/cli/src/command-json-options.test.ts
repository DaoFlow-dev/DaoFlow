import { describe, expect, test } from "bun:test";
import type { Command } from "commander";
import { deployCommand } from "./commands/deploy";
import { diffCommand } from "./commands/diff";
import { doctorCommand } from "./commands/doctor";
import { envCommand } from "./commands/env";
import { loginCommand } from "./commands/login";
import { logsCommand } from "./commands/logs";
import { planCommand } from "./commands/plan";
import { serverCommand } from "./commands/server";

function hasLongOption(command: Command, longFlag: string): boolean {
  return command.options.some((option) => option.long === longFlag);
}

function getSubcommand(command: Command, name: string): Command {
  const child = command.commands.find((candidate) => candidate.name() === name);
  expect(child).toBeDefined();
  return child as Command;
}

function renderHelp(command: Command): string {
  const output: string[] = [];
  command.configureOutput({
    writeOut: (str) => {
      output.push(str);
    },
    writeErr: (str) => {
      output.push(str);
    }
  });
  command.outputHelp();
  return output.join("");
}

describe("CLI JSON option coverage", () => {
  test("login declares --json", () => {
    expect(hasLongOption(loginCommand(), "--json")).toBe(true);
  });

  test("doctor declares --json", () => {
    expect(hasLongOption(doctorCommand(), "--json")).toBe(true);
  });

  test("deploy declares --json", () => {
    expect(hasLongOption(deployCommand(), "--json")).toBe(true);
  });

  test("deploy help includes scope, examples, and JSON shapes", () => {
    const help = renderHelp(deployCommand());
    expect(help).toContain("Required scope:");
    expect(help).toContain("--dry-run: deploy:read");
    expect(help).toContain("execute: deploy:start");
    expect(help).toContain("Examples:");
    expect(help).toContain("daoflow deploy --service svc_123 --dry-run --json");
    expect(help).toContain("Example JSON shapes:");
  });

  test("logs declares --json", () => {
    expect(hasLongOption(logsCommand(), "--json")).toBe(true);
  });

  test("plan declares --json", () => {
    expect(hasLongOption(planCommand(), "--json")).toBe(true);
  });

  test("plan help includes scope, examples, and JSON shape", () => {
    const help = renderHelp(planCommand());
    expect(help).toContain("Required scope:");
    expect(help).toContain("deploy:read");
    expect(help).toContain("Examples:");
    expect(help).toContain("--preview-branch feature/login --preview-pr 42");
    expect(help).toContain("daoflow plan --compose ./compose.yaml --server srv_123 --json");
    expect(help).toContain("Example JSON shape:");
  });

  test("diff declares --json", () => {
    expect(hasLongOption(diffCommand(), "--json")).toBe(true);
  });

  test("env pull and env push declare --json", () => {
    const env = envCommand();
    expect(hasLongOption(getSubcommand(env, "pull"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(env, "push"), "--json")).toBe(true);
  });

  test("server add declares --json", () => {
    const server = serverCommand();
    expect(hasLongOption(getSubcommand(server, "add"), "--json")).toBe(true);
  });

  test("server add help includes scope, examples, and JSON shapes", () => {
    const help = renderHelp(getSubcommand(serverCommand(), "add"));
    expect(help).toContain("Required scope:");
    expect(help).toContain("server:write");
    expect(help).toContain("Examples:");
    expect(help).toContain("daoflow server add --name edge-vps-1");
    expect(help).toContain("Example JSON shapes:");
  });
});
