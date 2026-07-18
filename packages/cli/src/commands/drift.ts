import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { getCurrentContext } from "../config";
import { createClient } from "../trpc-client";

export function driftCommand(): Command {
  return new Command("drift")
    .description("Show non-authoritative cached Compose drift snapshots")
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
  { "ok": true, "data": { "inspection": { "availability": "not-implemented" }, "summary": { "totalServices": 5, "cachedSnapshotServices": 3, "unavailableServices": 2 }, "reports": [{ "source": "cached-snapshot", "authoritative": false, "attemptedAt": "2026-07-18T12:00:00.000Z", "observedAt": "2026-07-18T12:00:00.000Z", "maxAgeSeconds": 900 }] } }
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
                `  Services: ${summary.totalServices}  Cached snapshots: ${summary.cachedSnapshotServices}  Unavailable: ${summary.unavailableServices}  Review required: ${summary.reviewRequired}`
              );
              console.log(
                chalk.yellow(
                  `  Live inspection: ${report.inspection.availability}. Results are not authoritative.`
                )
              );
              console.log();

              if (report.reports.length === 0) {
                console.log(chalk.dim("  No Compose services are available for this team.\n"));
                return;
              }

              for (const svc of report.reports) {
                const statusColor =
                  svc.status === "blocked"
                    ? chalk.red
                    : svc.status === "drifted"
                      ? chalk.yellow
                      : chalk.yellow;
                console.log(`  ${svc.serviceName}  ${statusColor(svc.statusLabel)}`);
                console.log(
                  chalk.dim(
                    `    Source: ${svc.source} · Authoritative: no · Observed: ${svc.observedAt ?? "—"} · Attempted: ${svc.attemptedAt ?? "—"} · Max age: ${svc.maxAgeSeconds}s`
                  )
                );
                if (svc.summary) console.log(chalk.dim(`    ${svc.summary}`));
                if (svc.diffs && Array.isArray(svc.diffs) && svc.diffs.length > 0) {
                  for (const diff of svc.diffs) {
                    console.log(
                      `    ${chalk.dim(diff.field)}: ${chalk.red(diff.desiredValue ?? "—")} → ${chalk.yellow(diff.actualValue ?? "—")}`
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
