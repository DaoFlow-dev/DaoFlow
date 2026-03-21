import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction, type CommandActionError } from "../command-action";
import { getErrorMessage } from "../command-helpers";
import { createClient } from "../trpc-client";

function renderNotificationError(error: CommandActionError, ctx: { isJson: boolean }): void {
  if (ctx.isJson) {
    console.log(JSON.stringify({ ok: false, error: error.message, code: error.code }));
    return;
  }

  console.error(chalk.red(error.humanMessage ?? error.message));
}

function formatChannelTarget(channel: {
  channelType: string;
  email: string | null;
  webhookUrl: string | null;
}) {
  if (channel.channelType === "email") {
    return channel.email ?? "—";
  }

  if (channel.channelType === "web_push") {
    return "browser subscriptions";
  }

  return channel.webhookUrl ?? "—";
}

export function notificationsCommand(): Command {
  const notifications = new Command("notifications").description(
    "Inspect configured notification channels and delivery activity"
  );

  notifications
    .command("list")
    .description("List configured notification channels")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  any valid token

Examples:
  daoflow notifications list --json

Example JSON shape:
  { "ok": true, "data": { "channels": [{ "id": "ntf_123", "name": "Ops Alerts", "channelType": "slack", "enabled": true }] } }
`
    )
    .action(async (opts: { json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        renderError: renderNotificationError,
        action: async (ctx) => {
          try {
            const trpc = createClient();
            const channels = await trpc.listChannels.query();

            return ctx.success(
              { channels },
              {
                human: () => {
                  console.log(chalk.bold("\n  Notification Channels\n"));
                  if (channels.length === 0) {
                    console.log(chalk.dim("  No notification channels configured.\n"));
                    return;
                  }

                  const header = `  ${"NAME".padEnd(22)} ${"TYPE".padEnd(18)} ${"STATUS".padEnd(10)} ${"TARGET".padEnd(34)}`;
                  console.log(chalk.dim(header));
                  console.log(chalk.dim("  " + "─".repeat(90)));

                  for (const channel of channels) {
                    console.log(
                      `  ${channel.name.padEnd(22)} ${channel.channelType.padEnd(18)} ${(channel.enabled ? "enabled" : "disabled").padEnd(10)} ${formatChannelTarget(channel).padEnd(34)}`
                    );
                    const filters = [
                      channel.projectFilter ? `project=${channel.projectFilter}` : null,
                      channel.environmentFilter ? `env=${channel.environmentFilter}` : null
                    ]
                      .filter(Boolean)
                      .join(" ");
                    console.log(
                      chalk.dim(
                        `    selectors=${channel.eventSelectors.join(", ")}${filters ? `  ${filters}` : ""}`
                      )
                    );
                  }
                  console.log();
                }
              }
            );
          } catch (error) {
            ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
          }
        }
      });
    });

  notifications
    .command("logs")
    .description("List recent notification delivery attempts")
    .option("--json", "Output as JSON")
    .option("--limit <n>", "Maximum delivery attempts to show", "20")
    .addHelpText(
      "after",
      `
Required scope:
  any valid token

Examples:
  daoflow notifications logs --limit 50 --json

Example JSON shape:
  { "ok": true, "data": { "limit": 20, "logs": [{ "channelId": "ntf_123", "eventType": "deploy.failed", "status": "delivered" }] } }
`
    )
    .action(async (opts: { json?: boolean; limit: string }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        renderError: renderNotificationError,
        action: async (ctx) => {
          try {
            const trpc = createClient();
            const limit = Number(opts.limit);
            const logs = await trpc.listDeliveryLogs.query({ limit });

            return ctx.success(
              { limit, logs },
              {
                human: () => {
                  console.log(chalk.bold("\n  Notification Delivery Logs\n"));
                  if (logs.length === 0) {
                    console.log(chalk.dim("  No notification delivery attempts recorded.\n"));
                    return;
                  }

                  for (const log of logs) {
                    const status = log.status === "delivered" ? chalk.green("✓") : chalk.red("✗");
                    const httpStatus = log.httpStatus ?? "—";
                    console.log(
                      `  ${status} ${log.sentAt}  ${log.channelName}  ${log.eventType}  http=${httpStatus}`
                    );
                    if (log.error) {
                      console.log(chalk.dim(`    ${log.error}`));
                    }
                  }
                  console.log();
                }
              }
            );
          } catch (error) {
            ctx.fail(getErrorMessage(error), { code: "API_ERROR" });
          }
        }
      });
    });

  return notifications;
}
