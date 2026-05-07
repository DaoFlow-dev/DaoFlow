import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";

const HELP = [
  "",
  "Required scopes:",
  "  resources/history/logs: server:read",
  "  cleanup/patch: server:write",
  "  host terminal: terminal:open in the web UI",
  "",
  "Examples:",
  "  daoflow server ops resources --server srv_123 --json",
  "  daoflow server ops cleanup --server srv_123 --dry-run --json",
  "  daoflow server ops cleanup --server srv_123 --yes",
  "  daoflow server ops patch --server srv_123 --json"
].join("\n");

export function serverOperationsCommand(): Command {
  const ops = new Command("ops")
    .description("Inspect and run audited server operations")
    .addHelpText("after", HELP);

  ops
    .command("resources")
    .description("Collect host CPU, memory, disk, and Docker disk usage")
    .requiredOption("--server <id>", "Server ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { server: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const trpc = createClient();
          const result = await trpc.collectServerResources.mutate({
            serverId: normalizeCliInput(opts.server, "Server ID")
          });
          return ctx.success(result, {
            human: () => printOperation("Resource check", result)
          });
        }
      });
    });

  ops
    .command("cleanup")
    .description("Preview or run safe Docker host cleanup")
    .requiredOption("--server <id>", "Server ID")
    .option("--include-volumes", "Include unused Docker volumes")
    .option("--dry-run", "Preview cleanup without pruning")
    .option("-y, --yes", "Skip confirmation prompt for cleanup execution")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          server: string;
          includeVolumes?: boolean;
          dryRun?: boolean;
          yes?: boolean;
          json?: boolean;
        },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            const payload = {
              serverId: normalizeCliInput(opts.server, "Server ID"),
              includeVolumes: opts.includeVolumes === true
            };
            const trpc = createClient();
            if (opts.dryRun) {
              const result = await trpc.previewServerCleanup.mutate(payload);
              return ctx.success(result, {
                human: () => printOperation("Cleanup preview", result)
              });
            }

            ctx.requireConfirmation(
              opts.yes === true,
              `Run cleanup on server ${payload.serverId}. Pass --yes to confirm.`,
              {
                humanMessage: `Run cleanup on server ${payload.serverId}. Pass --yes to confirm.`
              }
            );
            const result = await trpc.runServerCleanup.mutate(payload);
            return ctx.success(result, {
              human: () => printOperation("Cleanup run", result)
            });
          }
        });
      }
    );

  ops
    .command("patch")
    .description("Queue a package patch plan without applying updates")
    .requiredOption("--server <id>", "Server ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { server: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const trpc = createClient();
          const result = await trpc.planServerPatches.mutate({
            serverId: normalizeCliInput(opts.server, "Server ID")
          });
          return ctx.success(result, {
            human: () => printOperation("Patch plan", result)
          });
        }
      });
    });

  ops
    .command("history")
    .description("List durable server operation history")
    .requiredOption("--server <id>", "Server ID")
    .option("--limit <n>", "Maximum operations", "20")
    .option("--json", "Output as JSON")
    .action(async (opts: { server: string; limit: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const trpc = createClient();
          const result = await trpc.serverOperationsHub.query({
            serverId: normalizeCliInput(opts.server, "Server ID"),
            limit: parseLimit(opts.limit)
          });
          return ctx.success(result, {
            human: () => {
              console.log(chalk.bold(`\n  Operations for ${result.server.name}\n`));
              for (const operation of result.operations) {
                console.log(`  ${operation.id}  ${operation.kind}  ${operation.status}`);
              }
              console.log();
            }
          });
        }
      });
    });

  return ops;
}

function parseLimit(value: string) {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 1 || parsed > 100) {
    throw new Error("Limit must be between 1 and 100.");
  }
  return parsed;
}

function printOperation(
  label: string,
  result: { operation?: { id: string; summary: string | null } }
) {
  console.log(chalk.green(`✓ ${label} recorded`));
  if (result.operation) {
    console.log(chalk.dim(`  Operation: ${result.operation.id}`));
    console.log(chalk.dim(`  ${result.operation.summary ?? ""}`));
  }
  console.log();
}
