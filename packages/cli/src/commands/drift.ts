import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { getCurrentContext } from "../config";
import { createClient } from "../trpc-client";

export function driftCommand(): Command {
  return new Command("drift")
    .description("Show config drift between desired and actual service state")
    .option("--limit <n>", "Maximum services to check", "24")
    .option("--json", "Output as JSON")
    .addHelpText(
      "after",
      `
Required scope:
  deploy:read

Examples:
  daoflow drift --json
  daoflow drift --limit 10

Example JSON shape:
  { "ok": true, "data": { "summary": { "totalServices": 5, "alignedServices": 4, "driftedServices": 1 }, "services": [...] } }
`
    )
    .action(async (opts: { limit: string; json?: boolean }, command: Command) => {
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
          if (!Number.isInteger(limit) || limit < 1 || limit > 100) {
            return ctx.fail("Limit must be between 1 and 100.", { code: "INVALID_INPUT" });
          }

          const trpc = createClient(currentContext);
          const report = await trpc.composeDriftReport.query({ limit });

          return ctx.success(report, {
            human: () => {
              console.log(chalk.bold("\n  Compose Drift Report\n"));
              const summary = report.summary;
              console.log(
                `  Services: ${summary.totalServices}  Aligned: ${chalk.green(String(summary.alignedServices))}  Drifted: ${summary.driftedServices > 0 ? chalk.red(String(summary.driftedServices)) : chalk.dim("0")}`
              );
              console.log();

              if (report.services.length === 0) {
                console.log(chalk.dim("  No compose services to check.\n"));
                return;
              }

              for (const svc of report.services) {
                const statusColor =
                  svc.status === "aligned"
                    ? chalk.green
                    : svc.status === "drifted"
                      ? chalk.red
                      : chalk.yellow;
                console.log(`  ${svc.serviceName}  ${statusColor(svc.statusLabel)}`);
                if (svc.summary) console.log(chalk.dim(`    ${svc.summary}`));
                if (svc.diffs && Array.isArray(svc.diffs) && svc.diffs.length > 0) {
                  for (const diff of svc.diffs) {
                    console.log(
                      `    ${chalk.dim(diff.field)}: ${chalk.red(diff.expected ?? "—")} → ${chalk.green(diff.actual ?? "—")}`
                    );
                  }
                }
                console.log();
              }
            }
          });
        }
      });
    });
}
