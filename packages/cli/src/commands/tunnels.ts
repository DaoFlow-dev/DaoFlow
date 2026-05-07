import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { createClient } from "../trpc-client";

function collectRoute(
  value: string,
  previous: Array<{ hostname: string; service: string; status: "active" }> = []
) {
  const [hostname, service = ""] = value.split("=");
  if (!hostname || !service) {
    throw new Error("Routes must use hostname=service format.");
  }
  return [...previous, { hostname, service, status: "active" as const }];
}

function parseTunnelStatus(value: string): "active" | "inactive" | "error" {
  if (value === "active" || value === "inactive" || value === "error") {
    return value;
  }
  throw new Error("Status must be active, inactive, or error.");
}

export function tunnelsCommand(): Command {
  const tunnels = new Command("tunnels").description("Manage observed external tunnels");

  tunnels
    .command("list")
    .description("List managed tunnels and observed routes")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  server:read

Examples:
  daoflow tunnels list --json
`
    )
    .action(async (opts: { json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const data = await createClient().managedTunnels.query();
          return ctx.success(
            { tunnels: data },
            {
              human: () => {
                console.log(chalk.bold("\n  Managed Tunnels\n"));
                if (data.length === 0) {
                  console.log(chalk.dim("  No managed tunnels registered.\n"));
                  return;
                }
                for (const tunnel of data) {
                  console.log(`  ${chalk.cyan(tunnel.name)}  ${chalk.dim(tunnel.id)}`);
                  console.log(
                    chalk.dim(
                      `    ${tunnel.status} · ${tunnel.domain ?? "no domain"} · ${tunnel.routes.length} routes`
                    )
                  );
                }
                console.log();
              }
            }
          );
        }
      });
    });

  tunnels
    .command("create")
    .description("Register a managed tunnel")
    .requiredOption("--name <name>", "Tunnel display name")
    .option("--provider-tunnel-id <id>", "Provider tunnel ID")
    .option("--domain <domain>", "Primary tunnel domain")
    .option("--credentials <json>", "Provider credentials JSON")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          name: string;
          providerTunnelId?: string;
          domain?: string;
          credentials?: string;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            ctx.requireConfirmation(
              opts.yes === true,
              `Create managed tunnel ${opts.name}. Pass --yes to confirm.`
            );
            const tunnel = await createClient().createManagedTunnel.mutate({
              name: opts.name,
              tunnelId: opts.providerTunnelId,
              domain: opts.domain,
              credentials: opts.credentials
            });
            return ctx.success({ tunnel }, { quiet: () => tunnel.id });
          }
        });
      }
    );

  tunnels
    .command("sync")
    .description("Replace observed routes for a managed tunnel")
    .requiredOption("--tunnel-id <id>", "Managed tunnel ID")
    .option("--route <hostname=service>", "Observed route", collectRoute, [])
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          tunnelId: string;
          route: Array<{ hostname: string; service: string; status: "active" }>;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            ctx.requireConfirmation(
              opts.yes === true,
              `Sync ${opts.route.length} routes for tunnel ${opts.tunnelId}. Pass --yes to confirm.`
            );
            const tunnel = await createClient().syncManagedTunnelRoutes.mutate({
              tunnelId: opts.tunnelId,
              routes: opts.route
            });
            return ctx.success({ tunnel });
          }
        });
      }
    );

  tunnels
    .command("update")
    .description("Update managed tunnel metadata")
    .requiredOption("--tunnel-id <id>", "Managed tunnel ID")
    .option("--name <name>", "Tunnel display name")
    .option("--provider-tunnel-id <id>", "Provider tunnel ID")
    .option("--domain <domain>", "Primary tunnel domain")
    .option("--status <status>", "active, inactive, or error", parseTunnelStatus)
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          tunnelId: string;
          name?: string;
          providerTunnelId?: string;
          domain?: string;
          status?: "active" | "inactive" | "error";
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            ctx.requireConfirmation(
              opts.yes === true,
              `Update managed tunnel ${opts.tunnelId}. Pass --yes to confirm.`
            );
            const tunnel = await createClient().updateManagedTunnel.mutate({
              tunnelId: opts.tunnelId,
              name: opts.name,
              providerTunnelId: opts.providerTunnelId,
              domain: opts.domain,
              status: opts.status
            });
            return ctx.success({ tunnel });
          }
        });
      }
    );

  tunnels
    .command("rotate")
    .description("Rotate stored tunnel credentials")
    .requiredOption("--tunnel-id <id>", "Managed tunnel ID")
    .requiredOption("--credentials <json>", "Replacement credentials JSON")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: { tunnelId: string; credentials: string; yes?: boolean; json?: boolean },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            ctx.requireConfirmation(
              opts.yes === true,
              `Rotate credentials for tunnel ${opts.tunnelId}. Pass --yes to confirm.`
            );
            const tunnel = await createClient().rotateManagedTunnelCredentials.mutate({
              tunnelId: opts.tunnelId,
              credentials: opts.credentials
            });
            return ctx.success({ tunnel });
          }
        });
      }
    );

  tunnels
    .command("delete")
    .description("Delete a managed tunnel")
    .requiredOption("--tunnel-id <id>", "Managed tunnel ID")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (opts: { tunnelId: string; yes?: boolean; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          ctx.requireConfirmation(
            opts.yes === true,
            `Delete managed tunnel ${opts.tunnelId}. Pass --yes to confirm.`
          );
          const result = await createClient().deleteManagedTunnel.mutate({
            tunnelId: opts.tunnelId
          });
          return ctx.success(result);
        }
      });
    });

  return tunnels;
}
