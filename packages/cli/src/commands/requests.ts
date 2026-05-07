import { Command } from "commander";
import chalk from "chalk";
import { normalizeAuditSinceWindow } from "@daoflow/shared";
import { runCommandAction } from "../command-action";
import { getCurrentContext } from "../config";
import { createClient, type RouterOutputs } from "../trpc-client";

function parseLimit(rawLimit: string): number {
  const limit = Number.parseInt(rawLimit, 10);
  if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
    throw new Error("Limit must be an integer between 1 and 100.");
  }

  return limit;
}

function parseSlowMs(rawSlowMs?: string): number | undefined {
  if (!rawSlowMs) {
    return undefined;
  }

  const slowMs = Number.parseInt(rawSlowMs, 10);
  if (!Number.isInteger(slowMs) || slowMs < 1 || slowMs > 120_000) {
    throw new Error("Slow threshold must be an integer between 1 and 120000 milliseconds.");
  }

  return slowMs;
}

function colorizeOutcome(outcome: string): string {
  if (outcome === "success") return chalk.green(outcome);
  if (outcome === "denied") return chalk.yellow(outcome);
  return chalk.red(outcome);
}

function renderRequests(entries: RouterOutputs["requestAccessLogs"]["entries"]): void {
  if (entries.length === 0) {
    console.log(chalk.dim("  No request records found.\n"));
    return;
  }

  for (const entry of entries) {
    console.log(
      `  ${entry.createdAt}  ${colorizeOutcome(entry.outcome)}  ${entry.method} ${entry.path}`
    );
    console.log(
      chalk.dim(
        `    ${entry.statusCode} in ${entry.durationMs}ms  Request: ${entry.requestId}  Category: ${entry.category}`
      )
    );
    console.log(
      chalk.dim(
        `    Actor: ${entry.actorLabel}  Token: ${entry.tokenLabel ?? "—"}  IP: ${entry.sourceIp ?? "—"}`
      )
    );
    if (entry.errorCategory) {
      console.log(chalk.dim(`    Error: ${entry.errorCategory}`));
    }
    console.log();
  }
}

export function requestsCommand(): Command {
  return new Command("requests")
    .description("Read durable request and access logs")
    .option("--limit <n>", "Maximum request records to show", "25")
    .option("--since <window>", "Only include records newer than a window like 15m, 1h, or 7d")
    .option("--category <category>", "Filter by auth, api, trpc, webhook, health, or other")
    .option("--failed-auth", "Show failed authentication and authorization requests")
    .option("--api-token", "Show API token-backed requests")
    .option("--webhooks", "Show webhook endpoint requests")
    .option("--slow-ms <ms>", "Show requests slower than this duration")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  logs:read

Examples:
  daoflow requests --limit 20
  daoflow requests --failed-auth --json
  daoflow requests --api-token --since 1h
  daoflow requests --webhooks --slow-ms 1000
`
    )
    .action(
      async (
        opts: {
          json?: boolean;
          limit: string;
          since?: string;
          category?: string;
          failedAuth?: boolean;
          apiToken?: boolean;
          webhooks?: boolean;
          slowMs?: string;
        },
        command: Command
      ) => {
        await runCommandAction({
          command,
          json: opts.json,
          action: async (ctx) => {
            const currentContext = getCurrentContext();
            if (!currentContext) {
              return ctx.fail("Not logged in. Run `daoflow login` first.", {
                code: "NOT_LOGGED_IN"
              });
            }

            const parsed = (() => {
              try {
                return {
                  limit: parseLimit(opts.limit),
                  since: opts.since ? normalizeAuditSinceWindow(opts.since) : undefined,
                  slowMs: parseSlowMs(opts.slowMs)
                };
              } catch (error) {
                return ctx.fail(error instanceof Error ? error.message : String(error), {
                  code: "INVALID_INPUT"
                });
              }
            })();

            const trpc = createClient(currentContext);
            const logs = await trpc.requestAccessLogs.query({
              limit: parsed.limit,
              since: parsed.since,
              category: opts.category as
                | "auth"
                | "api"
                | "trpc"
                | "webhook"
                | "health"
                | "other"
                | undefined,
              failedAuth: opts.failedAuth,
              apiTokenOnly: opts.apiToken,
              webhooksOnly: opts.webhooks,
              slowMs: parsed.slowMs
            });

            return ctx.success(
              {
                limit: parsed.limit,
                since: parsed.since ?? null,
                summary: logs.summary,
                entries: logs.entries
              },
              {
                human: () => {
                  console.log(chalk.bold("\n  Request Access Logs\n"));
                  console.log(
                    `  Total: ${logs.summary.totalRequests}  Failed: ${logs.summary.failedRequests}  Denied: ${logs.summary.deniedRequests}  Tokens: ${logs.summary.apiTokenRequests}  Webhooks: ${logs.summary.webhookRequests}`
                  );
                  if (parsed.since) {
                    console.log(chalk.dim(`  Window: last ${parsed.since}`));
                  }
                  console.log();
                  renderRequests(logs.entries);
                }
              }
            );
          }
        });
      }
    );
}
