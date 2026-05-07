import { Command } from "commander";
import chalk from "chalk";
import { runCommandAction } from "../command-action";
import { createClient, type RouterOutputs } from "../trpc-client";

const HELP = [
  "",
  "Required scopes:",
  "  report: server:write",
  "  run: server:write",
  "",
  "Examples:",
  "  daoflow maintenance report --json",
  "  daoflow maintenance run --dry-run --json",
  "  daoflow maintenance run --yes",
  "",
  "Example JSON shapes:",
  '  report: { "ok": true, "data": { "generatedAt": "...", "current": { ... }, "latestRun": null } }',
  '  run: { "ok": true, "data": { "dryRun": false, "summary": "Cleanup processed ..." } }'
].join("\n");

type MaintenanceReport = RouterOutputs["operationalMaintenanceReport"];

export function maintenanceCommand(): Command {
  const command = new Command("maintenance")
    .description("Inspect and run audited operational maintenance")
    .addHelpText("after", HELP);

  command
    .command("report")
    .description("Show current maintenance candidates")
    .option("--json", "Output as JSON")
    .action(async (opts: { json?: boolean }, command: Command) => {
      await runCommandAction<MaintenanceReport>({
        command,
        json: opts.json,
        action: async (ctx) => {
          const report = await createClient().operationalMaintenanceReport.query();
          return ctx.success(report, {
            human: () => printReport(report)
          });
        }
      });
    });

  command
    .command("run")
    .description("Run or dry-run operational maintenance cleanup")
    .option("--dry-run", "Preview cleanup without mutating")
    .option("-y, --yes", "Confirm live cleanup")
    .option("--json", "Output as JSON")
    .action(async (opts: { dryRun?: boolean; yes?: boolean; json?: boolean }, command: Command) => {
      await runCommandAction({
        command,
        json: opts.json,
        action: async (ctx) => {
          const dryRun = opts.dryRun === true;
          if (!dryRun) {
            ctx.requireConfirmation(
              opts.yes === true,
              "Run operational maintenance cleanup. Pass --yes to confirm.",
              {
                humanMessage: "Run operational maintenance cleanup. Pass --yes to confirm."
              }
            );
          }

          const result = await createClient().runOperationalMaintenance.mutate({ dryRun });
          return ctx.success(result, {
            human: () => printRunResult(result)
          });
        }
      });
    });

  return command;
}

function printReport(report: MaintenanceReport) {
  console.log(chalk.bold("\n  Operational maintenance\n"));
  console.log(`  Stalled deployments:    ${report.current.stalledDeployments.eligibleCount}`);
  console.log(`  Stale previews:         ${report.current.stalePreviews.eligibleCount}`);
  console.log(`  Expired CLI sign-ins:   ${report.current.expiredCliAuthRequests.eligibleCount}`);
  console.log(`  Retained artifacts:     ${report.current.retainedArtifacts.eligibleCount}`);
  if (report.latestRun) {
    console.log(chalk.dim(`  Latest run:             ${report.latestRun.action}`));
  }
  console.log();
}

function printRunResult(result: { dryRun?: boolean; summary?: string }) {
  console.log(
    chalk.green(result.dryRun ? "✓ Maintenance dry run completed" : "✓ Maintenance run completed")
  );
  if (result.summary) {
    console.log(chalk.dim(`  ${result.summary}`));
  }
  console.log();
}
