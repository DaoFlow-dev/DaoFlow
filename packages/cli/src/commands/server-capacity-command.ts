import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";

const SERVER_CAPACITY_HELP_TEXT = [
  "",
  "Required scope:",
  "  server:write",
  "",
  "Examples:",
  "  daoflow server capacity --server srv_123 --max-concurrent-builds 1 --max-queued-deployments 20 --dry-run --json",
  "  daoflow server capacity --server srv_123 --max-concurrent-builds 2 --max-queued-deployments 50 --yes",
  "",
  "Example JSON shapes:",
  '  dry-run: { "ok": true, "data": { "dryRun": true, "serverId": "srv_123", "maxConcurrentBuilds": 1, "maxQueuedDeployments": 20 } }',
  '  execute: { "ok": true, "data": { "server": { "id": "srv_123", "maxConcurrentBuilds": 1, "maxQueuedDeployments": 20 } } }'
].join("\n");

function parseBoundedInteger(value: string, minimum: number, maximum: number): number | null {
  const parsed = Number(value);
  if (!Number.isInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null;
  }
  return parsed;
}

interface ServerCapacityDryRunResult {
  dryRun: true;
  serverId: string;
  maxConcurrentBuilds: number;
  maxQueuedDeployments: number;
}

interface ServerCapacitySuccessResult {
  server: {
    id: string;
    name: string;
    host: string;
    maxConcurrentBuilds: number;
    maxQueuedDeployments: number;
  };
}

export function serverCapacityCommand(): Command {
  return new Command("capacity")
    .description("Configure per-server build concurrency and deployment queue limits")
    .requiredOption("--server <id>", "Server ID")
    .requiredOption("--max-concurrent-builds <count>", "Maximum active builds (1-20)")
    .requiredOption("--max-queued-deployments <count>", "Maximum queued deployments (1-500)")
    .option("--dry-run", "Preview the capacity settings without mutating")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .addHelpText("after", SERVER_CAPACITY_HELP_TEXT)
    .action(
      async (
        opts: {
          server: string;
          maxConcurrentBuilds: string;
          maxQueuedDeployments: string;
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction<ServerCapacityDryRunResult | ServerCapacitySuccessResult>({
          command,
          json: opts.json,
          action: async (ctx) => {
            const serverId = normalizeCliInput(opts.server, "Server ID");
            const maxConcurrentBuilds = parseBoundedInteger(opts.maxConcurrentBuilds, 1, 20);
            if (maxConcurrentBuilds === null) {
              return ctx.fail("Maximum concurrent builds must be an integer between 1 and 20.", {
                code: "INVALID_INPUT"
              });
            }
            const maxQueuedDeployments = parseBoundedInteger(opts.maxQueuedDeployments, 1, 500);
            if (maxQueuedDeployments === null) {
              return ctx.fail("Maximum queued deployments must be an integer between 1 and 500.", {
                code: "INVALID_INPUT"
              });
            }

            const payload = { serverId, maxConcurrentBuilds, maxQueuedDeployments };
            if (opts.dryRun) {
              return ctx.dryRun({ dryRun: true, ...payload });
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Configure deployment capacity for server ${serverId}. Pass --yes to confirm.`
            );

            const trpc = createClient();
            const server = await trpc.configureServerCapacity.mutate(payload);

            return ctx.success(
              {
                server: {
                  id: server.id,
                  name: server.name,
                  host: server.host,
                  maxConcurrentBuilds: server.maxConcurrentBuilds,
                  maxQueuedDeployments: server.maxQueuedDeployments
                }
              },
              {
                quiet: () => server.id,
                human: () => {
                  console.log(chalk.green(`✓ Updated deployment capacity for ${server.name}`));
                  console.log(chalk.dim(`  Concurrent builds: ${server.maxConcurrentBuilds}`));
                  console.log(chalk.dim(`  Queued deployments: ${server.maxQueuedDeployments}`));
                  console.log();
                }
              }
            );
          }
        });
      }
    );
}
