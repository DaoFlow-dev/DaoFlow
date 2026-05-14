import { Command } from "commander";
import chalk from "chalk";
import { normalizeAuditSinceWindow } from "@daoflow/shared";
import { runCommandAction } from "../command-action";
import { getCurrentContext } from "../config";
import { createClient } from "../trpc-client";

function severityColor(severity: string, text: string): string {
  if (severity === "critical") return chalk.bgRed.white(text);
  if (severity === "error") return chalk.red(text);
  if (severity === "warning") return chalk.yellow(text);
  return chalk.dim(text);
}

export function eventsCommand(): Command {
  return new Command("events")
    .description("Query the normalized event timeline")
    .option("--limit <n>", "Maximum events to return", "50")
    .option("--since <window>", "Time window filter (e.g. 15m, 1h, 7d)")
    .option("--kind <pattern>", "Filter by event kind (e.g. deployment.*, backup.failed)")
    .option("--severity <level>", "Filter by severity: info, warning, error, critical")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  events:read

Examples:
  daoflow events --since 1h --json
  daoflow events --kind "deployment.*" --limit 20
  daoflow events --severity error --since 7d --json

Example JSON shape:
  { "ok": true, "data": { "summary": { "totalEvents": 42, "returnedEvents": 20 }, "events": [{ "id": "event_1", "kind": "deployment.started", "resourceType": "deployment", "resourceId": "dep_123", "summary": "...", "severity": "info", "createdAt": "..." }] } }
`
    )
    .action(
      async (
        opts: {
          json?: boolean;
          limit: string;
          since?: string;
          kind?: string;
          severity?: string;
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

            const limit = parseInt(opts.limit, 10);
            if (!Number.isInteger(limit) || limit < 1 || limit > 200) {
              return ctx.fail("Limit must be between 1 and 200.", { code: "INVALID_INPUT" });
            }

            let since: string | undefined;
            if (opts.since) {
              try {
                since = normalizeAuditSinceWindow(opts.since);
              } catch (error) {
                return ctx.fail(error instanceof Error ? error.message : String(error), {
                  code: "INVALID_INPUT"
                });
              }
            }

            const trpc = createClient(currentContext);
            const result = await trpc.eventTimeline.query({
              limit,
              since,
              kind: opts.kind,
              severity: opts.severity as "info" | "warning" | "error" | "critical" | undefined
            });

            return ctx.success(result, {
              human: () => {
                console.log(chalk.bold("\n  Event Timeline\n"));
                console.log(
                  `  Total: ${result.summary.totalEvents}  Showing: ${result.summary.returnedEvents}`
                );
                if (since) console.log(chalk.dim(`  Window: last ${since}`));
                console.log();

                if (result.events.length === 0) {
                  console.log(chalk.dim("  No events recorded.\n"));
                  return;
                }

                for (const event of result.events) {
                  const sev = severityColor(event.severity, event.severity.toUpperCase().padEnd(8));
                  console.log(`  ${event.createdAt}  ${sev}  ${event.kind}`);
                  console.log(`    ${event.summary}`);
                  if (event.detail) console.log(chalk.dim(`    ${event.detail}`));
                  console.log();
                }
              }
            });
          }
        });
      }
    );
}
