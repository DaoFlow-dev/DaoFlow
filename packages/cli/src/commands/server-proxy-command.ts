import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { normalizeCliInput, normalizeOptionalCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";

interface ServerProxyConfigureResult {
  server: {
    id: string;
    name: string;
    host: string;
    metadata: unknown;
  };
}

export function serverProxyCommand(): Command {
  return new Command("proxy")
    .description("Configure DaoFlow-managed Traefik routing for a server")
    .requiredOption("--server <id>", "Server ID")
    .option("--disable", "Disable managed Traefik routing")
    .option("--network <name>", "External Traefik Docker network", "daoflow-proxy")
    .option("--entrypoint <name>", "Traefik HTTPS entrypoint", "websecure")
    .option("--cert-resolver <name>", "Traefik certificate resolver", "letsencrypt")
    .option("--dns-target <host>", "Expected DNS target for managed hostnames")
    .option("--dry-run", "Preview the proxy payload without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          server: string;
          disable?: boolean;
          network?: string;
          entrypoint?: string;
          certResolver?: string;
          dnsTarget?: string;
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction<Record<string, unknown> | ServerProxyConfigureResult>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const payload = {
              serverId: normalizeCliInput(opts.server, "Server ID"),
              enabled: opts.disable !== true,
              networkName: normalizeOptionalCliInput(opts.network, "Proxy network"),
              entrypoint: normalizeOptionalCliInput(opts.entrypoint, "Traefik entrypoint"),
              certificateResolver: normalizeOptionalCliInput(
                opts.certResolver,
                "Certificate resolver"
              ),
              dnsTarget: normalizeOptionalCliInput(opts.dnsTarget, "DNS target")
            };

            if (opts.dryRun) {
              return ctx.dryRun({ dryRun: true, ...payload });
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Configure managed Traefik routing for server ${payload.serverId}. Pass --yes to confirm.`,
              {
                humanMessage: `Configure managed Traefik routing for server ${payload.serverId}. Pass --yes to confirm.`
              }
            );

            const trpc = createClient();
            const server = await trpc.configureServerManagedTraefikProxy.mutate(payload);

            return ctx.success(
              {
                server: {
                  id: server.id,
                  name: server.name,
                  host: server.host,
                  metadata: server.metadata
                }
              },
              {
                quiet: () => server.id,
                human: () => {
                  console.log(chalk.green(`✓ Updated managed proxy for ${server.name}`));
                  console.log(chalk.dim(`  Server: ${server.id}`));
                  console.log(chalk.dim(`  Host:   ${server.host}`));
                  console.log();
                }
              }
            );
          }
        });
      }
    );
}
