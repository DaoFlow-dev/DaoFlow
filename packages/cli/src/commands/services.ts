import { Command } from "commander";
import chalk from "chalk";
import { getErrorMessage, resolveCommandJsonOption } from "../command-helpers";
import { createClient } from "../trpc-client";

export function servicesCommand(): Command {
  return new Command("services")
    .description("List services and their status")
    .option("--json", "Output as JSON")
    .option("--project <id>", "Filter by project ID")
    .action(async (opts: { json?: boolean; project?: string }, command: Command) => {
      const isJson = resolveCommandJsonOption(command, opts.json);
      try {
        const trpc = createClient();
        const query: Record<string, unknown> = {};
        if (opts.project) query.projectId = opts.project;
        const data = await trpc.composeReleaseCatalog.query(query);

        if (isJson) {
          console.log(JSON.stringify({ ok: true, data }));
          return;
        }

        console.log(chalk.bold("\n  Services\n"));

        if (!data.services?.length) {
          console.log(chalk.dim("  No services found.\n"));
          return;
        }

        const header = `  ${"SERVICE".padEnd(24)} ${"STATUS".padEnd(14)} ${"SERVER".padEnd(20)} ${"IMAGE".padEnd(30)}`;
        console.log(chalk.dim(header));
        console.log(chalk.dim("  " + "─".repeat(90)));

        for (const svc of data.services) {
          const statusColor =
            svc.status === "completed"
              ? chalk.green
              : svc.status === "failed"
                ? chalk.red
                : chalk.yellow;

          console.log(
            `  ${svc.serviceName.padEnd(24)} ${statusColor(svc.status.padEnd(14))} ${(svc.targetServerName ?? "").padEnd(20)} ${(svc.imageTag ?? "—").padEnd(30)}`
          );
        }
        console.log();
      } catch (error) {
        if (isJson) {
          console.log(
            JSON.stringify({ ok: false, error: getErrorMessage(error), code: "API_ERROR" })
          );
        } else {
          console.error(chalk.red(`✗ ${getErrorMessage(error)}`));
        }
        process.exit(1);
      }
    });
}
