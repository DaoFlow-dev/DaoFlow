import { describe, expect, test } from "bun:test";
import type { Command } from "commander";
import { approvalsCommand } from "./commands/approvals";
import { auditCommand } from "./commands/audit";
import { deployCommand } from "./commands/deploy";
import { diffCommand } from "./commands/diff";
import { doctorCommand } from "./commands/doctor";
import { envCommand } from "./commands/env";
import { loginCommand } from "./commands/login";
import { logsCommand } from "./commands/logs";
import { notificationsCommand } from "./commands/notifications";
import { planCommand } from "./commands/plan";
import { serverCommand } from "./commands/server";
import { backupCommand } from "./commands/backup";
import { volumesCommand } from "./commands/volumes";
import { rollbackCommand } from "./commands/rollback";

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

  test("audit declares --json", () => {
    expect(hasLongOption(auditCommand(), "--json")).toBe(true);
  });

  test("audit help includes access, examples, and JSON shape", () => {
    const help = renderHelp(auditCommand());
    expect(help).toContain("Required scope:");
    expect(help).toContain("any valid token");
    expect(help).toContain("daoflow audit --since 1h --json");
    expect(help).toContain("Example JSON shape:");
  });

  test("approvals subcommands declare --json", () => {
    const approvals = approvalsCommand();
    expect(hasLongOption(getSubcommand(approvals, "list"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(approvals, "approve"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(approvals, "reject"), "--json")).toBe(true);
  });

  test("approvals help includes access, examples, and JSON shapes", () => {
    const approvals = approvalsCommand();

    const listHelp = renderHelp(getSubcommand(approvals, "list"));
    expect(listHelp).toContain("Required scope:");
    expect(listHelp).toContain("any valid token");
    expect(listHelp).toContain("daoflow approvals list --limit 10 --json");
    expect(listHelp).toContain("Example JSON shape:");

    const approveHelp = renderHelp(getSubcommand(approvals, "approve"));
    expect(approveHelp).toContain("Required scope:");
    expect(approveHelp).toContain("approvals:decide");
    expect(approveHelp).toContain("daoflow approvals approve --request apr_123 --yes --json");
    expect(approveHelp).toContain("Example JSON shape:");

    const rejectHelp = renderHelp(getSubcommand(approvals, "reject"));
    expect(rejectHelp).toContain("Required scope:");
    expect(rejectHelp).toContain("approvals:decide");
    expect(rejectHelp).toContain("daoflow approvals reject --request apr_123 --yes --json");
    expect(rejectHelp).toContain("Example JSON shape:");
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

  test("notifications list and logs declare --json", () => {
    const notifications = notificationsCommand();
    expect(hasLongOption(getSubcommand(notifications, "list"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(notifications, "logs"), "--json")).toBe(true);
  });

  test("notifications help includes access, examples, and JSON shapes", () => {
    const notifications = notificationsCommand();
    const listHelp = renderHelp(getSubcommand(notifications, "list"));
    expect(listHelp).toContain("Required scope:");
    expect(listHelp).toContain("any valid token");
    expect(listHelp).toContain("daoflow notifications list --json");
    expect(listHelp).toContain("Example JSON shape:");

    const logsHelp = renderHelp(getSubcommand(notifications, "logs"));
    expect(logsHelp).toContain("Required scope:");
    expect(logsHelp).toContain("daoflow notifications logs --limit 50 --json");
    expect(logsHelp).toContain("Example JSON shape:");
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

  test("env subcommands declare --json", () => {
    const env = envCommand();
    expect(hasLongOption(getSubcommand(env, "pull"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(env, "push"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(env, "list"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(env, "set"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(env, "delete"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(env, "resolve"), "--json")).toBe(true);
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

  test("backup policy create declares --json", () => {
    const backup = backupCommand();
    const policy = getSubcommand(backup, "policy");
    expect(hasLongOption(getSubcommand(policy, "create"), "--json")).toBe(true);
  });

  test("backup policy create help includes scope, examples, and JSON shapes", () => {
    const help = renderHelp(getSubcommand(getSubcommand(backupCommand(), "policy"), "create"));
    expect(help).toContain("Required scope:");
    expect(help).toContain("backup:run");
    expect(help).toContain("Examples:");
    expect(help).toContain("daoflow backup policy create --name nightly-db");
    expect(help).toContain("Example JSON shapes:");
  });

  test("volumes list and register declare --json", () => {
    const volumes = volumesCommand();
    expect(hasLongOption(getSubcommand(volumes, "list"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(volumes, "register"), "--json")).toBe(true);
  });

  test("volumes register help includes scope, examples, and JSON shapes", () => {
    const help = renderHelp(getSubcommand(volumesCommand(), "register"));
    expect(help).toContain("Required scope:");
    expect(help).toContain("volumes:write");
    expect(help).toContain("Examples:");
    expect(help).toContain("daoflow volumes register --name postgres-data");
    expect(help).toContain("Example JSON shapes:");
  });

  test("rollback declares --json", () => {
    expect(hasLongOption(rollbackCommand(), "--json")).toBe(true);
  });

  test("rollback declares --dry-run and --yes safety flags", () => {
    const cmd = rollbackCommand();
    expect(hasLongOption(cmd, "--dry-run")).toBe(true);
    expect(hasLongOption(cmd, "--yes")).toBe(true);
  });

  test("rollback declares --service and --target options", () => {
    const cmd = rollbackCommand();
    expect(hasLongOption(cmd, "--service")).toBe(true);
    expect(hasLongOption(cmd, "--target")).toBe(true);
    expect(hasLongOption(cmd, "--to")).toBe(true);
  });
});
