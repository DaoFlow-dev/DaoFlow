import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { createClient } from "../trpc-client";

function parseHeader(value: string, previous: Record<string, string> = {}) {
  const [key, ...rest] = value.split("=");
  const headerValue = rest.join("=");
  if (!key || !headerValue) {
    throw new Error("Headers must use key=value format.");
  }
  return { ...previous, [key]: headerValue };
}

export function logDrainsCommand(): Command {
  const drains = new Command("log-drains").description("Manage external log drains");

  drains
    .command("list")
    .description("List configured log drains")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const data = await createClient().logDrains.query();
          return ctx.success(
            { drains: data },
            {
              human: () => {
                console.log(chalk.bold("\n  Log Drains\n"));
                for (const drain of data) {
                  console.log(`  ${chalk.cyan(drain.name)}  ${chalk.dim(drain.id)}`);
                  console.log(chalk.dim(`    ${drain.destinationType} · ${drain.status}`));
                }
                if (data.length === 0) console.log(chalk.dim("  No log drains configured."));
                console.log();
              }
            }
          );
        }
      });
    });

  drains
    .command("create")
    .description("Configure an external log drain")
    .requiredOption("--name <name>", "Drain name")
    .requiredOption("--type <type>", "webhook, generic_http, loki, or s3")
    .requiredOption("--endpoint-url <url>", "Delivery endpoint URL")
    .option("--header <key=value>", "HTTP header", parseHeader, {})
    .option("--service <name>", "Service filter")
    .option("--environment <name>", "Environment filter")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (
        opts: {
          name: string;
          type: "webhook" | "generic_http" | "loki" | "s3";
          endpointUrl: string;
          header: Record<string, string>;
          service?: string;
          environment?: string;
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
              `Create log drain ${opts.name}. Pass --yes to confirm.`
            );
            const drain = await createClient().createLogDrain.mutate({
              name: opts.name,
              destinationType: opts.type,
              endpointUrl: opts.endpointUrl,
              headers: opts.header,
              serviceFilter: opts.service,
              environmentFilter: opts.environment
            });
            return ctx.success({ drain }, { quiet: () => drain.id });
          }
        });
      }
    );

  drains
    .command("test")
    .description("Send a test delivery to a log drain")
    .requiredOption("--drain-id <id>", "Log drain ID")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (opts: { drainId: string; yes?: boolean; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          ctx.requireConfirmation(
            opts.yes === true,
            `Test log drain ${opts.drainId}. Pass --yes to confirm.`
          );
          const result = await createClient().testLogDrain.mutate({ drainId: opts.drainId });
          return ctx.success(result);
        }
      });
    });

  drains
    .command("deliveries")
    .description("List log drain delivery attempts")
    .option("--limit <n>", "Delivery attempts to show", "50")
    .option("--json", "Output as JSON")
    .action(async (opts: { limit: string; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const deliveries = await createClient().logDrainDeliveries.query({
            limit: Number.parseInt(opts.limit, 10)
          });
          return ctx.success({ deliveries });
        }
      });
    });

  drains
    .command("retry")
    .description("Retry a failed log drain delivery")
    .requiredOption("--delivery-id <id>", "Delivery attempt ID")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(
      async (opts: { deliveryId: string; yes?: boolean; json?: boolean }, command: Command) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            ctx.requireConfirmation(
              opts.yes === true,
              `Retry log drain delivery ${opts.deliveryId}. Pass --yes to confirm.`
            );
            const result = await createClient().retryLogDrainDelivery.mutate({
              deliveryId: opts.deliveryId
            });
            return ctx.success(result);
          }
        });
      }
    );

  drains
    .command("delete")
    .description("Delete a log drain")
    .requiredOption("--drain-id <id>", "Log drain ID")
    .option("-y, --yes", "Skip confirmation prompt")
    .option("--json", "Output as JSON")
    .action(async (opts: { drainId: string; yes?: boolean; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          ctx.requireConfirmation(
            opts.yes === true,
            `Delete log drain ${opts.drainId}. Pass --yes to confirm.`
          );
          const result = await createClient().deleteLogDrain.mutate({ drainId: opts.drainId });
          return ctx.success(result);
        }
      });
    });

  return drains;
}
