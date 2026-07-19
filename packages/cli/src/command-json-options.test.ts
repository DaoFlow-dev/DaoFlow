import { describe, expect, test } from "bun:test";
import type { Command } from "commander";
import { approvalsCommand } from "./commands/approvals";
import { auditCommand } from "./commands/audit";
import { accessLogsCommand } from "./commands/access-logs";
import { accessAssetsCommand } from "./commands/access-assets";
import { deployCommand } from "./commands/deploy";
import { diffCommand } from "./commands/diff";
import { doctorCommand } from "./commands/doctor";
import { envCommand } from "./commands/env";
import { loginCommand } from "./commands/login";
import { logDrainsCommand } from "./commands/log-drains";
import { logsCommand } from "./commands/logs";
import { maintenanceCommand } from "./commands/maintenance";
import { notificationsCommand } from "./commands/notifications";
import { planCommand } from "./commands/plan";
import { serverCommand } from "./commands/server";
import { servicesCommand } from "./commands/services";
import { backupCommand } from "./commands/backup";
import { terminalCommand } from "./commands/terminal";
import { tunnelsCommand } from "./commands/tunnels";
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
    const command = loginCommand();
    expect(hasLongOption(command, "--json")).toBe(true);
    expect(hasLongOption(command, "--totp-code")).toBe(true);
    expect(hasLongOption(command, "--recovery-code")).toBe(true);
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

  test("access-logs declares --json and documents scope", () => {
    const command = accessLogsCommand();
    const help = renderHelp(command);
    expect(hasLongOption(command, "--json")).toBe(true);
    expect(help).toContain("Required scope:");
    expect(help).toContain("logs:read");
    expect(help).toContain("daoflow access-logs --status failed-auth --json");
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
    expect(hasLongOption(logsCommand(), "--service-id")).toBe(true);
  });

  test("maintenance subcommands declare --json", () => {
    const maintenance = maintenanceCommand();
    expect(hasLongOption(getSubcommand(maintenance, "report"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(maintenance, "run"), "--json")).toBe(true);
  });

  test("terminal service declares --json", () => {
    const terminal = terminalCommand();
    expect(hasLongOption(getSubcommand(terminal, "service"), "--json")).toBe(true);
  });

  test("service logging commands declare --json and document access", () => {
    const services = servicesCommand();
    const logging = getSubcommand(services, "logging");
    const show = getSubcommand(logging, "show");
    const set = getSubcommand(logging, "set");
    const clear = getSubcommand(logging, "clear");

    for (const command of [show, set, clear]) {
      expect(hasLongOption(command, "--json")).toBe(true);
      expect(renderHelp(command)).toContain("Required scope");
      expect(renderHelp(command)).toContain("Example JSON shape:");
    }
    expect(renderHelp(show)).toContain("diagnostics:read");
    expect(renderHelp(set)).toContain("deploy:read");
    expect(renderHelp(set)).toContain("service:update");
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

  test("tunnels and log-drains subcommands declare --json", () => {
    const tunnels = tunnelsCommand();
    expect(hasLongOption(getSubcommand(tunnels, "list"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(tunnels, "create"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(tunnels, "sync"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(tunnels, "update"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(tunnels, "rotate"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(tunnels, "delete"), "--json")).toBe(true);

    const drains = logDrainsCommand();
    expect(hasLongOption(getSubcommand(drains, "list"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(drains, "create"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(drains, "test"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(drains, "deliveries"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(drains, "retry"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(drains, "delete"), "--json")).toBe(true);
  });

  test("access asset subcommands declare --json", () => {
    const access = accessAssetsCommand();
    const sshKey = getSubcommand(access, "ssh-key");
    const certificate = getSubcommand(access, "certificate");
    expect(hasLongOption(getSubcommand(sshKey, "list"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(sshKey, "create"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(sshKey, "rotate"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(sshKey, "attach"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(sshKey, "detach"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(sshKey, "delete"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(certificate, "list"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(certificate, "create"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(certificate, "delete"), "--json")).toBe(true);
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
    expect(hasLongOption(getSubcommand(server, "capacity"), "--json")).toBe(true);
  });

  test("server ops subcommands declare --json", () => {
    const ops = getSubcommand(serverCommand(), "ops");
    const swarm = getSubcommand(ops, "swarm");
    const swarmNode = getSubcommand(swarm, "node");
    const swarmService = getSubcommand(swarm, "service");
    expect(hasLongOption(getSubcommand(ops, "resources"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(ops, "cleanup"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(ops, "patch"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(ops, "history"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(ops, "logs"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(swarm, "refresh-topology"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(swarmNode, "availability"), "--json")).toBe(true);
    expect(hasLongOption(getSubcommand(swarmService, "scale"), "--json")).toBe(true);
  });

  test("server add help includes scope, examples, and JSON shapes", () => {
    const help = renderHelp(getSubcommand(serverCommand(), "add"));
    expect(help).toContain("Required scope:");
    expect(help).toContain("server:write");
    expect(help).toContain("Examples:");
    expect(help).toContain("daoflow server add --name edge-vps-1");
    expect(help).toContain("Example JSON shapes:");

    const capacityHelp = renderHelp(getSubcommand(serverCommand(), "capacity"));
    expect(capacityHelp).toContain("server:write");
    expect(capacityHelp).toContain("--max-concurrent-builds 1");
    expect(capacityHelp).toContain("Example JSON shapes:");
  });

  test("server ops help includes scopes and examples", () => {
    const help = renderHelp(getSubcommand(serverCommand(), "ops"));
    expect(help).toContain("Required scopes:");
    expect(help).toContain("server:read");
    expect(help).toContain("server:write");
    expect(help).toContain("daoflow server ops cleanup --server srv_123 --dry-run --json");
    expect(help).toContain("daoflow server ops swarm refresh-topology --server srv_123 --json");
  });

  test("maintenance help includes scopes and examples", () => {
    const help = renderHelp(maintenanceCommand());
    expect(help).toContain("Required scopes:");
    expect(help).toContain("server:write");
    expect(help).toContain("daoflow maintenance run --dry-run --json");
  });

  test("terminal help includes terminal scope and examples", () => {
    const help = renderHelp(terminalCommand());
    expect(help).toContain("Required scope:");
    expect(help).toContain("terminal:open");
    expect(help).toContain("daoflow terminal service --service svc_123");
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

  test("backup recovery commands declare JSON and safety options", () => {
    const recovery = getSubcommand(backupCommand(), "recovery");
    const plan = getSubcommand(recovery, "plan");
    const run = getSubcommand(recovery, "run");
    const restore = getSubcommand(recovery, "restore");
    const list = getSubcommand(recovery, "list");
    const inspect = getSubcommand(recovery, "inspect");
    const metadata = getSubcommand(recovery, "download-metadata");

    for (const command of [plan, run, restore, list, inspect, metadata]) {
      expect(hasLongOption(command, "--json")).toBe(true);
    }
    expect(hasLongOption(run, "--dry-run")).toBe(true);
    expect(hasLongOption(run, "--yes")).toBe(true);
    expect(hasLongOption(restore, "--dry-run")).toBe(true);
    expect(hasLongOption(restore, "--yes")).toBe(true);
    expect(hasLongOption(restore, "--confirm")).toBe(true);
    expect(hasLongOption(restore, "--external-secrets")).toBe(true);
    expect(hasLongOption(plan, "--destination")).toBe(true);
    expect(hasLongOption(run, "--destination")).toBe(true);
    expect(hasLongOption(inspect, "--bundle")).toBe(true);
    expect(hasLongOption(metadata, "--bundle")).toBe(true);
  });

  test("backup recovery help documents scopes and examples", () => {
    const recovery = getSubcommand(backupCommand(), "recovery");
    const planHelp = renderHelp(getSubcommand(recovery, "plan"));
    const runHelp = renderHelp(getSubcommand(recovery, "run"));
    const restoreHelp = renderHelp(getSubcommand(recovery, "restore"));

    expect(planHelp).toContain("backup:read");
    expect(planHelp).toContain("daoflow backup recovery plan --destination dest_123 --json");
    expect(runHelp).toContain("backup:run");
    expect(runHelp).toContain("--dry-run");
    expect(runHelp).toContain("--yes");
    expect(restoreHelp).toContain("no running DaoFlow API");
    expect(restoreHelp).toContain("--confirm");
    expect(restoreHelp).toContain("Example JSON shapes:");
    expect(restoreHelp).toContain("PLAN_HASH_MISMATCH");
    expect(restoreHelp).toContain('"error":');
    expect(restoreHelp).not.toContain('"message":');
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
