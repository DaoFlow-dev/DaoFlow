import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { normalizeCliInput } from "../command-helpers";
import { createClient } from "../trpc-client";

export function serverSwarmOperationsCommand(): Command {
  const swarm = new Command("swarm").description("Manage Docker Swarm targets");

  swarm
    .command("refresh-topology")
    .description("Refresh observed Swarm topology from the manager")
    .requiredOption("--server <id>", "Server ID")
    .option("--json", "Output as JSON")
    .action(async (opts: { server: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const result = await createClient().refreshSwarmTopology.mutate({
            serverId: normalizeCliInput(opts.server, "Server ID")
          });
          return ctx.success(result, {
            human: () => printOperation("Swarm topology refresh", result)
          });
        }
      });
    });

  const node = swarm.command("node").description("Manage Swarm nodes");
  node
    .command("availability")
    .description("Plan or apply Swarm node availability")
    .requiredOption("--server <id>", "Server ID")
    .requiredOption("--node <id>", "Node ID or hostname")
    .requiredOption("--availability <state>", "active, pause, or drain")
    .option("--dry-run", "Plan the node update without applying it")
    .option("-y, --yes", "Confirm the node update")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          server: string;
          node: string;
          availability: string;
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
              node: normalizeCliInput(opts.node, "Swarm node"),
              availability: parseAvailability(opts.availability),
              dryRun: opts.dryRun === true
            };

            if (!payload.dryRun) {
              ctx.requireConfirmation(
                opts.yes === true,
                `Set node ${payload.node} availability to ${payload.availability}. Pass --yes to confirm.`,
                {
                  humanMessage: `Set node ${payload.node} availability to ${payload.availability}. Pass --yes to confirm.`
                }
              );
            }

            const result = await createClient().updateSwarmNodeAvailability.mutate(payload);
            return ctx.success(result, {
              human: () => printOperation("Swarm node availability", result)
            });
          }
        });
      }
    );

  const service = swarm.command("service").description("Manage Swarm services");
  service
    .command("scale")
    .description("Plan or apply Swarm service replica scaling")
    .requiredOption("--server <id>", "Server ID")
    .requiredOption("--service <name>", "Swarm service name")
    .requiredOption("--replicas <count>", "Replica count")
    .option("--dry-run", "Plan the scale update without applying it")
    .option("-y, --yes", "Confirm the scale update")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          server: string;
          service: string;
          replicas: string;
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
              service: normalizeCliInput(opts.service, "Swarm service"),
              replicas: parseReplicas(opts.replicas),
              dryRun: opts.dryRun === true
            };

            if (!payload.dryRun) {
              ctx.requireConfirmation(
                opts.yes === true,
                `Scale service ${payload.service} to ${payload.replicas} replicas. Pass --yes to confirm.`,
                {
                  humanMessage: `Scale service ${payload.service} to ${payload.replicas} replicas. Pass --yes to confirm.`
                }
              );
            }

            const result = await createClient().updateSwarmServiceScale.mutate(payload);
            return ctx.success(result, {
              human: () => printOperation("Swarm service scale", result)
            });
          }
        });
      }
    );

  return swarm;
}

function parseAvailability(value: string): "active" | "pause" | "drain" {
  if (value === "active" || value === "pause" || value === "drain") {
    return value;
  }
  throw new Error("Availability must be active, pause, or drain.");
}

function parseReplicas(value: string): number {
  const parsed = Number.parseInt(value, 10);
  if (!Number.isInteger(parsed) || parsed < 0 || parsed > 100) {
    throw new Error("Replicas must be between 0 and 100.");
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
